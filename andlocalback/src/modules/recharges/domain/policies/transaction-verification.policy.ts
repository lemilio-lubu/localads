import { OcrAnalysis, OcrFailure } from "../ocr/ocr-analysis";
import { VerificationIssue, VerificationStatus } from "../recharge.types";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type VerificationEvaluationInput = {
  expectedAmount: MonetaryAmount;
  ocr: OcrAnalysis | null;
  ocrFailure?: OcrFailure | null;
  receiptAlreadyConfirmed?: boolean;
  bankReferenceAlreadyConfirmed?: boolean;
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
