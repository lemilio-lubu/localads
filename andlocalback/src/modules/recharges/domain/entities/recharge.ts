import { ApplicationError } from "../../../../common/errors/application.error";
import { Money } from "../value-objects/money";
import {
  AccountType, AdvertisingPlatform, OcrResult, PaymentObligation, PaymentStatus, ReceiptStatus,
  ReceiptVerification, RechargeStatus, StoredReceipt, VerificationIssue, VerificationStatus,
} from "../recharge.types";

type RechargeProps = {
  id: string;
  accountId: string;
  accountType: AccountType;
  campaignId: string;
  platform: AdvertisingPlatform;
  amount: Money;
  receipts?: StoredReceipt[];
  createdAt: Date;
};

export class Recharge {
  public paymentStatus = PaymentStatus.PENDING;
  public status = RechargeStatus.PENDING_VERIFICATION;
  public receiptStatus: ReceiptStatus | null = null;
  public verifications: ReceiptVerification[] = [];
  public obligation: PaymentObligation | null = null;

  constructor(public readonly props: RechargeProps) {
    this.receiptStatus = props.receipts?.length ? ReceiptStatus.UPLOADED : null;
  }

  get receipts() { return this.props.receipts ?? []; }
  get receipt() { return this.receipts.at(-1) ?? null; }
  get verification() { return this.verifications.at(-1) ?? null; }

  addReceipt(receipt: StoredReceipt) {
    if (!this.props.receipts) this.props.receipts = [];
    this.props.receipts.push(receipt);
    this.receiptStatus = ReceiptStatus.UPLOADED;
  }

  submitPrepaidForReview(result: OcrResult, confidenceThreshold: number, verificationId?: string) {
    this.assertPrepaidReceipt();
    const requestedAmount = this.props.amount.toAmount();
    const detectedAmount = result.detectedAmounts.find((amount) => amount === requestedAmount)
      ?? result.detectedAmounts[0]
      ?? null;
    const amountMatches = detectedAmount === null ? null : detectedAmount === requestedAmount;
    const issues: VerificationIssue[] = [];

    if (detectedAmount === null) issues.push(VerificationIssue.AMOUNT_NOT_FOUND);
    else if (!amountMatches) issues.push(VerificationIssue.AMOUNT_MISMATCH);
    if (result.confidence < confidenceThreshold) issues.push(VerificationIssue.LOW_CONFIDENCE);

    this.paymentStatus = PaymentStatus.UNDER_REVIEW;
    this.status = RechargeStatus.PENDING_VERIFICATION;
    this.receiptStatus = ReceiptStatus.PROCESSED;
    this.verifications.push(this.buildVerification({ id: verificationId, confidence: result.confidence, detectedAmount, amountMatches, issues, failureReason: null }));
  }

  recordOcrFailure(reason: string, verificationId?: string) {
    this.assertPrepaidReceipt();
    this.paymentStatus = PaymentStatus.UNDER_REVIEW;
    this.status = RechargeStatus.PENDING_VERIFICATION;
    this.receiptStatus = ReceiptStatus.FAILED;
    this.verifications.push(this.buildVerification({ id: verificationId, confidence: null, detectedAmount: null, amountMatches: null, issues: [VerificationIssue.OCR_FAILURE], failureReason: reason }));
  }

  approvePrepaidVerification(administratorId: string, decidedAt = new Date()) {
    const verification = this.assertPendingVerification();
    if (verification.amountMatches !== true) {
      throw new ApplicationError("AMOUNT_MISMATCH", "El monto detectado no coincide con el solicitado", 409);
    }
    this.replaceLatestVerification({ ...verification, status: VerificationStatus.APPROVED, requiresManualReview: false, decidedBy: administratorId, decidedAt: decidedAt.toISOString() });
    this.paymentStatus = PaymentStatus.PAID;
    this.status = RechargeStatus.APPROVED;
  }

  rejectPrepaidVerification(administratorId: string, reason: string, decidedAt = new Date()) {
    const verification = this.assertPendingVerification();
    this.replaceLatestVerification({ ...verification, status: VerificationStatus.REJECTED, requiresManualReview: false, decidedBy: administratorId, decidedAt: decidedAt.toISOString(), rejectionReason: reason });
    this.paymentStatus = PaymentStatus.REJECTED;
    this.status = RechargeStatus.REJECTED;
  }

  approvePostpaid(obligationId: string, creditDays: number, createdAt = new Date()) {
    if (this.props.accountType !== AccountType.POSTPAID) {
      throw new ApplicationError("INVALID_PAYMENT_FLOW", "La recarga no pertenece al flujo postpago", 409);
    }
    const dueDate = new Date(createdAt);
    dueDate.setUTCDate(dueDate.getUTCDate() + creditDays);
    this.paymentStatus = PaymentStatus.ON_CREDIT;
    this.status = RechargeStatus.APPROVED;
    this.obligation = { id: obligationId, amount: this.props.amount.toAmount(), status: PaymentStatus.ON_CREDIT, dueDate: dueDate.toISOString(), createdAt: createdAt.toISOString() };
  }

  moveToProcessing() {
    const paymentAllowsProcessing = this.props.accountType === AccountType.POSTPAID || this.paymentStatus === PaymentStatus.PAID;
    if (this.status !== RechargeStatus.APPROVED || !paymentAllowsProcessing) {
      throw new ApplicationError("INVALID_RECHARGE_TRANSITION", "La recarga no cumple las condiciones para pasar a en proceso", 409);
    }
    this.status = RechargeStatus.IN_PROCESS;
  }

  toPrimitives() {
    return {
      id: this.props.id, accountId: this.props.accountId, accountType: this.props.accountType,
      campaignId: this.props.campaignId, platform: this.props.platform, amount: this.props.amount.toAmount(),
      receipt: this.receipt, receipts: this.receipts, receiptStatus: this.receiptStatus,
      verification: this.verification, verifications: this.verifications, obligation: this.obligation,
      paymentStatus: this.paymentStatus, status: this.status,
      canTransitionToProcessing: this.status === RechargeStatus.APPROVED && (this.props.accountType === AccountType.POSTPAID || this.paymentStatus === PaymentStatus.PAID),
      createdAt: this.props.createdAt.toISOString(),
    };
  }

  private assertPrepaidReceipt() {
    if (this.props.accountType !== AccountType.PREPAID) throw new ApplicationError("INVALID_PAYMENT_FLOW", "La recarga no pertenece al flujo prepago", 409);
    if (!this.receipt) throw new ApplicationError("RECEIPT_REQUIRED", "La cuenta prepago requiere un comprobante");
  }

  private assertPendingVerification() {
    const verification = this.verification;
    if (this.props.accountType !== AccountType.PREPAID || this.paymentStatus !== PaymentStatus.UNDER_REVIEW || verification?.status !== VerificationStatus.UNDER_REVIEW) {
      throw new ApplicationError("INVALID_VERIFICATION_TRANSITION", "La verificación no está pendiente de revisión", 409);
    }
    return verification;
  }

  private replaceLatestVerification(verification: ReceiptVerification) {
    this.verifications[this.verifications.length - 1] = verification;
  }

  private buildVerification(input: Pick<ReceiptVerification, "confidence" | "detectedAmount" | "amountMatches" | "issues" | "failureReason"> & { id?: string }): ReceiptVerification {
    return {
      id: input.id ?? `${this.props.id}-verification-${this.verifications.length + 1}`,
      receiptId: this.receipt!.id,
      status: VerificationStatus.UNDER_REVIEW,
      requestedAmount: this.props.amount.toAmount(),
      confidence: input.confidence,
      detectedAmount: input.detectedAmount,
      amountMatches: input.amountMatches,
      issues: input.issues,
      failureReason: input.failureReason,
      requiresManualReview: true,
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      createdAt: new Date().toISOString(),
    };
  }
}
