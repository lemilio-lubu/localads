import { OcrAnalysis } from "../../domain/ocr/ocr-analysis";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { AccountType, VerificationIssue, VerificationStatus } from "../../domain/recharge.types";

export type TransactionReceiptStatus = "LOADED" | "PROCESSING" | "PROCESSED" | "FAILED" | "REJECTED";
export type TransactionVerificationStatus = VerificationStatus;
export type TransactionVerificationIssue = VerificationIssue;

export type TransactionReceiptSnapshot = Readonly<{
  id: string;
  paymentId: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  checksum: string;
  status: TransactionReceiptStatus;
  version: number;
}>;

export type ExtractedTransactionReceiptData = Readonly<{
  bank: string | null;
  detectedAmount: number | null;
  detectedDate: Date | null;
  transactionCode: string | null;
  originator: string | null;
  confidence: number | null;
  rawText: string | null;
}>;

export type ReceiptEvaluation = Readonly<{
  status: VerificationStatus.UNDER_REVIEW | VerificationStatus.AUTOMATICALLY_VERIFIED;
  amountMatches: boolean | null;
  issues: readonly TransactionVerificationIssue[];
  requiresManualReview: boolean;
}>;

export type DuplicatePaymentEvidence = Readonly<{
  checksumUsed: boolean;
  transactionCodeUsed: boolean;
}>;

export type ReceiptProcessingContext = Readonly<{
  transaction: Readonly<{ id: string; accountId: string; status: string; version: number }>;
  payment: Readonly<{ id: string; transactionId: string; status: string; expectedAmount: number; version: number }>;
  receipt: TransactionReceiptSnapshot;
  existingVerification: TransactionVerificationView | null;
}>;

export type TransactionVerificationView = Readonly<{
  id: string;
  transactionId: string;
  paymentId: string;
  receiptId: string;
  ocrResultId: string | null;
  status: TransactionVerificationStatus;
  expectedAmount: number;
  detectedAmount: number | null;
  amountMatches: boolean | null;
  issues: readonly TransactionVerificationIssue[];
  requiresManualReview: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  reviewReason: string | null;
  rejectionReason: string | null;
  version: number;
}>;

export type VerificationDecisionContext = Readonly<{
  transaction: Readonly<{
    id: string;
    accountId: string;
    accountTypeSnapshot: AccountType;
    status: TransactionRechargeStatus;
    version: number;
  }>;
  payment: Readonly<{
    id: string;
    status: TransactionPaymentStatus;
    expectedAmount: number;
    dueDate: Date | null;
    version: number;
  }>;
  receipt: TransactionReceiptSnapshot;
  ocr: ExtractedTransactionReceiptData | null;
  verification: TransactionVerificationView;
}>;

export interface TransactionReceiptOcrPort {
  process(receipt: TransactionReceiptSnapshot): Promise<OcrAnalysis>;
}

export interface TransactionVerificationPersistencePort {
  loadReceiptContext(receiptId: string): Promise<ReceiptProcessingContext | null>;
  loadVerificationContext(verificationId: string): Promise<VerificationDecisionContext | null>;
  findConfirmedDuplicates(input: Readonly<{
    excludePaymentId: string;
    checksum: string;
    transactionCode: string | null;
  }>): Promise<DuplicatePaymentEvidence>;

  /** Marks the receipt processed and creates both OCR result and verification atomically. */
  saveOcrEvaluation(input: Readonly<{
    context: ReceiptProcessingContext;
    ocrResultId: string;
    verificationId: string;
    extracted: ExtractedTransactionReceiptData;
    evaluation: ReceiptEvaluation;
  }>): Promise<TransactionVerificationView>;

  /** OCR failure is auditable and does not reject or confirm the payment. */
  saveOcrFailure(input: Readonly<{
    context: ReceiptProcessingContext;
    ocrResultId: string;
    verificationId: string;
    failureReason: string;
  }>): Promise<TransactionVerificationView>;

  /** Rechecks expected versions/states and commits verification, payment, transaction and all details. */
  approveAtomically(input: Readonly<{
    context: VerificationDecisionContext;
    administratorId: string;
    notes: string | null;
    decidedAt: Date;
  }>): Promise<TransactionVerificationView>;

  /** Marks or keeps the verification under review without changing financial or recharge state. */
  markUnderReviewAtomically(input: Readonly<{
    context: VerificationDecisionContext;
    administratorId: string;
    reason: string;
    reviewedAt: Date;
  }>): Promise<TransactionVerificationView>;

  /** Rechecks expected versions/states and rejects verification, receipt and payment atomically. */
  rejectAtomically(input: Readonly<{
    context: VerificationDecisionContext;
    administratorId: string;
    reason: string;
    decidedAt: Date;
  }>): Promise<TransactionVerificationView>;
}

export interface PaymentReceiptPersistencePort {
  loadPaymentForReceipt(paymentId: string): Promise<Readonly<{
    id: string;
    clientId: string;
    status: string;
    version: number;
  }> | null>;
  saveUploadedReceipt(input: Readonly<{
    paymentId: string;
    expectedPaymentVersion: number;
    receipt: Readonly<{
      id: string;
      originalName: string;
      mimeType: string;
      size: number;
      url: string;
      checksum: string;
    }>;
  }>): Promise<TransactionReceiptSnapshot>;
}

export type VerificationRealtimeEvent = Readonly<{
  eventId: string;
  verificationId: string;
  transactionId: string;
  accountId: string;
  status: TransactionVerificationStatus;
  paymentStatus: TransactionPaymentStatus;
  rechargeStatus: TransactionRechargeStatus;
  reason: string | null;
  version: number;
  occurredAt: string;
}>;

export interface VerificationRealtimePublisher {
  publishVerification(event: VerificationRealtimeEvent): void;
}

export const TRANSACTION_VERIFICATION_PERSISTENCE = Symbol("TRANSACTION_VERIFICATION_PERSISTENCE");
export const TRANSACTION_RECEIPT_OCR = Symbol("TRANSACTION_RECEIPT_OCR");
export const PAYMENT_RECEIPT_PERSISTENCE = Symbol("PAYMENT_RECEIPT_PERSISTENCE");
export const VERIFICATION_REALTIME_PUBLISHER = Symbol("VERIFICATION_REALTIME_PUBLISHER");
