import { OcrAnalysis, OcrFailure } from "../ocr/ocr-analysis";
import { plainText } from "../ocr/receipt-text-interpreter";
import { VerificationIssue, VerificationStatus } from "../recharge.types";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type VerificationEvaluationInput = {
  expectedAmount: MonetaryAmount;
  ocr: OcrAnalysis | null;
  ocrFailure?: OcrFailure | null;
  receiptAlreadyConfirmed?: boolean;
  bankReferenceAlreadyConfirmed?: boolean;
  /** Nuestro código (TX-…): el cliente lo pone como referencia de la transferencia. */
  transactionCode?: string;
  /* Otras referencias que también valen (la del cliente, AND-…): basta con que el comprobante mencione una. */
  acceptedReferences?: readonly string[];
  evaluatedAt?: Date;
};

export type VerificationPolicyOptions = {
  minimumConfidence?: number;
  maximumAgeDays?: number;
  maximumFutureDays?: number;
  requireAdministratorApproval?: boolean;
};

export type VerificationEvaluation = {
  status: VerificationStatus.AUTOMATICALLY_VERIFIED | VerificationStatus.UNDER_REVIEW;
  issues: VerificationIssue[];
  detectedAmount: MonetaryAmount | null;
  amountMatches: boolean | null;
  requiresAdministratorApproval: boolean;
  /** An automated evaluation is evidence only and never rejects a real payment. */
  rejectsPayment: false;
  failureReason: string | null;
};

/* El código liga la transferencia a esta recarga. Basta su primer tramo
   (TX-f6789e61): los bancos cortan la descripción y esos 8 caracteres ya son
   únicos en la práctica. Se toleran las confusiones típicas del OCR (O por 0,
   I o L por 1), que no son ambiguas porque el código es hexadecimal. */
function mentionsTransactionCode(text: string, code: string): boolean {
  const ocrSafe = (value: string) => plainText(value).replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^A-Z0-9]/g, "");
  const firstBlock = code.replace(/^TX-/i, "").split("-")[0];
  const key = ocrSafe(firstBlock.length >= 6 ? firstBlock : code);
  return key.length > 0 && ocrSafe(text).includes(key);
}

export class TransactionVerificationPolicy {
  private readonly minimumConfidence: number;
  private readonly maximumAgeDays: number;
  private readonly maximumFutureDays: number;
  private readonly requireAdministratorApproval: boolean;

  constructor(options: VerificationPolicyOptions = {}) {
    this.minimumConfidence = options.minimumConfidence ?? 80;
    this.maximumAgeDays = options.maximumAgeDays ?? 30;
    this.maximumFutureDays = options.maximumFutureDays ?? 1;
    this.requireAdministratorApproval = options.requireAdministratorApproval ?? true;
  }

  evaluate(input: VerificationEvaluationInput): VerificationEvaluation {
    const issues: VerificationIssue[] = [];
    const ocr = input.ocr;
    const detectedAmount = ocr?.detectedAmounts.find((amount) => amount.equals(input.expectedAmount))
      ?? ocr?.detectedAmounts[0]
      ?? null;
    const amountMatches = detectedAmount ? detectedAmount.equals(input.expectedAmount) : null;

    if (input.ocrFailure || !ocr) issues.push(VerificationIssue.OCR_FAILURE);
    if (!detectedAmount) issues.push(VerificationIssue.AMOUNT_NOT_FOUND);
    else if (!amountMatches) issues.push(VerificationIssue.AMOUNT_MISMATCH);
    if (ocr && ocr.confidence < this.minimumConfidence) issues.push(VerificationIssue.LOW_CONFIDENCE);
    if (ocr && !ocr.bank) issues.push(VerificationIssue.BANK_NOT_IDENTIFIED);
    if (ocr && !ocr.bankReference) issues.push(VerificationIssue.BANK_REFERENCE_NOT_IDENTIFIED);
    if (ocr && !this.isDateReasonable(ocr.transactionDate, input.evaluatedAt ?? new Date())) {
      issues.push(VerificationIssue.DATE_OUT_OF_RANGE);
    }
    const references = [input.transactionCode, ...(input.acceptedReferences ?? [])].filter((reference): reference is string => Boolean(reference));
    if (ocr && references.length > 0 && !references.some((reference) => mentionsTransactionCode(ocr.originalText, reference))) {
      issues.push(VerificationIssue.TRANSACTION_CODE_NOT_FOUND);
    }
    if (input.receiptAlreadyConfirmed) issues.push(VerificationIssue.DUPLICATE_RECEIPT);
    if (input.bankReferenceAlreadyConfirmed) issues.push(VerificationIssue.DUPLICATE_BANK_REFERENCE);

    const automaticallyVerified = issues.length === 0;
    return {
      status: automaticallyVerified ? VerificationStatus.AUTOMATICALLY_VERIFIED : VerificationStatus.UNDER_REVIEW,
      issues,
      detectedAmount,
      amountMatches,
      requiresAdministratorApproval: automaticallyVerified ? this.requireAdministratorApproval : true,
      rejectsPayment: false,
      failureReason: input.ocrFailure?.reason ?? null,
    };
  }

  private isDateReasonable(transactionDate: Date | null, evaluatedAt: Date): boolean {
    if (!transactionDate || Number.isNaN(transactionDate.getTime())) return false;
    const day = 86_400_000;
    const difference = evaluatedAt.getTime() - transactionDate.getTime();
    return difference <= this.maximumAgeDays * day && difference >= -this.maximumFutureDays * day;
  }
}
