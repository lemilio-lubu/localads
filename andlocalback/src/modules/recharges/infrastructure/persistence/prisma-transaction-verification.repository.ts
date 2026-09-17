import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApplicationError } from "../../../../common/errors/application.error";
import { PrismaService } from "../../../../database/prisma.service";
import { VerificationIssue, VerificationStatus } from "../../domain/recharge.types";
import { AccountType } from "../../domain/recharge.types";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import {
  DuplicatePaymentEvidence,
  ExtractedTransactionReceiptData,
  PaymentReceiptPersistencePort,
  ReceiptProcessingContext,
  TransactionReceiptSnapshot,
  TransactionVerificationIssue,
  TransactionVerificationPersistencePort,
  TransactionVerificationStatus,
  TransactionVerificationView,
  VerificationDecisionContext,
} from "../../application/ports/transaction-verification.ports";

const receiptContextInclude = {
  payment: { include: { transaction: true } },
  verification: true,
} satisfies Prisma.PaymentReceiptInclude;

const verificationContextInclude = {
  transaction: true,
  payment: true,
  receipt: true,
  ocrResult: true,
} satisfies Prisma.TransactionVerificationInclude;

@Injectable()
export class PrismaTransactionVerificationRepository
implements TransactionVerificationPersistencePort, PaymentReceiptPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async loadReceiptContext(receiptId: string): Promise<ReceiptProcessingContext | null> {
    const record = await this.prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
      include: receiptContextInclude,
    });
    if (!record) return null;
    return {
      transaction: {
        id: record.payment.transaction.id,
        accountId: record.payment.transaction.accountId,
        status: record.payment.transaction.rechargeStatus,
        version: record.payment.transaction.version,
      },
      payment: {
        id: record.payment.id,
        transactionId: record.payment.transactionId,
        status: record.payment.status,
        expectedAmount: decimalToNumber(record.payment.expectedAmount),
        version: record.payment.version,
      },
      receipt: toReceiptSnapshot(record),
      existingVerification: record.verification ? toVerificationView(record.verification) : null,
    };
  }

  async loadVerificationContext(verificationId: string): Promise<VerificationDecisionContext | null> {
    const record = await this.prisma.transactionVerification.findUnique({
      where: { id: verificationId },
      include: verificationContextInclude,
    });
    if (!record) return null;
    return {
      transaction: {
        id: record.transaction.id,
        accountId: record.transaction.accountId,
        accountTypeSnapshot: record.transaction.accountTypeSnapshot as AccountType,
        status: record.transaction.rechargeStatus as TransactionRechargeStatus,
        version: record.transaction.version,
      },
      payment: {
        id: record.payment.id,
        status: record.payment.status as TransactionPaymentStatus,
        expectedAmount: decimalToNumber(record.payment.expectedAmount),
        dueDate: record.payment.dueDate,
        version: record.payment.version,
      },
      receipt: toReceiptSnapshot(record.receipt),
      ocr: record.ocrResult ? toExtractedData(record.ocrResult) : null,
      verification: toVerificationView(record),
    };
  }

  async findConfirmedDuplicates(input: {
    excludePaymentId: string;
    checksum: string;
    transactionCode: string | null;
  }): Promise<DuplicatePaymentEvidence> {
    const normalizedCode = normalizeBankReference(input.transactionCode);
    const [receipt, code] = await Promise.all([
      this.prisma.confirmedPaymentEvidence.findFirst({
        where: { receiptChecksum: input.checksum, paymentId: { not: input.excludePaymentId } },
        select: { id: true },
      }),
      normalizedCode
        ? this.prisma.confirmedPaymentEvidence.findFirst({
          where: { bankReferenceNormalized: normalizedCode, paymentId: { not: input.excludePaymentId } },
          select: { id: true },
        })
        : Promise.resolve(null),
    ]);
    return { checksumUsed: receipt !== null, transactionCodeUsed: code !== null };
  }

  async saveOcrEvaluation(input: Parameters<TransactionVerificationPersistencePort["saveOcrEvaluation"]>[0]) {
    const existing = await this.findExistingVerification(input.context.receipt.id);
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (database) => {
        await assertProcessingContext(database, input.context);
        await claimReceipt(database, input.context.receipt, "PROCESSED");
        const ocr = await database.ocrResult.create({
          data: toOcrCreate(input.ocrResultId, input.context.receipt.id, input.extracted, null),
        });
        const verification = await database.transactionVerification.create({
          data: {
            id: input.verificationId,
            transactionId: input.context.transaction.id,
            paymentId: input.context.payment.id,
            receiptId: input.context.receipt.id,
            ocrResultId: ocr.id,
            status: input.evaluation.status,
            expectedAmount: new Prisma.Decimal(input.context.payment.expectedAmount),
            detectedAmount: decimalOrNull(input.extracted.detectedAmount),
            amountMatches: input.evaluation.amountMatches,
            issues: JSON.stringify(input.evaluation.issues),
            requiresManualReview: input.evaluation.requiresManualReview,
          },
        });
        return toVerificationView(verification);
      });
    } catch (error) {
      if (isUniqueError(error)) {
        const winner = await this.findExistingVerification(input.context.receipt.id);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async saveOcrFailure(input: Parameters<TransactionVerificationPersistencePort["saveOcrFailure"]>[0]) {
    const existing = await this.findExistingVerification(input.context.receipt.id);
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (database) => {
        await assertProcessingContext(database, input.context);
        await claimReceipt(database, input.context.receipt, "FAILED");
        const ocr = await database.ocrResult.create({
          data: toOcrCreate(input.ocrResultId, input.context.receipt.id, emptyExtractedData(), input.failureReason),
        });
        const verification = await database.transactionVerification.create({
          data: {
            id: input.verificationId,
            transactionId: input.context.transaction.id,
            paymentId: input.context.payment.id,
            receiptId: input.context.receipt.id,
            ocrResultId: ocr.id,
            status: VerificationStatus.UNDER_REVIEW,
            expectedAmount: new Prisma.Decimal(input.context.payment.expectedAmount),
            issues: JSON.stringify([VerificationIssue.OCR_FAILURE, VerificationIssue.AMOUNT_NOT_FOUND]),
            requiresManualReview: true,
          },
        });
        return toVerificationView(verification);
      });
    } catch (error) {
      if (isUniqueError(error)) {
        const winner = await this.findExistingVerification(input.context.receipt.id);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async approveAtomically(input: Parameters<TransactionVerificationPersistencePort["approveAtomically"]>[0]) {
    return this.decide(input.context, async (database) => {
      // Re-check inside the same financial transaction. The application check
      // gives a useful early response, while this closes the race in which a
      // different payment confirms the evidence immediately afterwards.
      const duplicates = await findConfirmedDuplicatesInTransaction(database, {
        excludePaymentId: input.context.payment.id,
        checksum: input.context.receipt.checksum,
        transactionCode: input.context.ocr?.transactionCode ?? null,
      });
      if (duplicates.checksumUsed) {
        throw conflict("RECEIPT_ALREADY_CONFIRMED", "El comprobante ya confirmo otro pago");
      }
      if (duplicates.transactionCodeUsed) {
        throw conflict("BANK_REFERENCE_ALREADY_CONFIRMED", "El codigo bancario ya confirmo otro pago");
      }
      await database.confirmedPaymentEvidence.create({
        data: {
          paymentId: input.context.payment.id,
          receiptId: input.context.receipt.id,
          verificationId: input.context.verification.id,
          receiptChecksum: input.context.receipt.checksum,
          bankReferenceNormalized: normalizeBankReference(input.context.ocr?.transactionCode ?? null),
          confirmedAt: input.decidedAt,
        },
      });
      await database.verificationDecisionAudit.create({
        data: {
          verificationId: input.context.verification.id,
          previousStatus: input.context.verification.status,
          resultingStatus: VerificationStatus.APPROVED,
          decision: "APPROVE",
          administratorUserId: input.administratorId,
          notes: input.notes,
          createdAt: input.decidedAt,
        },
      });
      const verification = await database.transactionVerification.update({
        where: { id: input.context.verification.id },
        data: {
          status: VerificationStatus.APPROVED, decidedBy: input.administratorId, decidedAt: input.decidedAt,
          decisionNotes: input.notes, reviewReason: null,
          version: input.context.verification.version + 1,
        },
      });
      await database.payment.update({
        where: { id: input.context.payment.id },
        data: {
          status: "PAID", confirmedAmount: input.context.payment.expectedAmount,
          confirmedAt: input.decidedAt, version: { increment: 1 },
        },
      });
      if (input.context.transaction.accountTypeSnapshot === AccountType.PREPAID) {
        await database.rechargeTransaction.update({
          where: { id: input.context.transaction.id },
          data: { rechargeStatus: "APPROVED", version: { increment: 1 } },
        });
        await database.transactionDetail.updateMany({
          where: { transactionId: input.context.transaction.id, status: "REQUESTED" },
          data: { status: "APPROVED", version: { increment: 1 } },
        });
      } else {
        // The credit is reserved when the POSTPAGO transaction is created and
        // released only after its payment is actually confirmed. Operational
        // recharge/detail states are intentionally untouched.
        // La liberación también opera en centavos enteros, para que el crédito
        // devuelto sea exactamente el reservado.
        const releasedCents = Number(MonetaryAmount.fromMajorUnits(input.context.payment.expectedAmount).cents);
        await database.$executeRaw`
          UPDATE Account
          SET creditUsed = MAX(0, CAST(ROUND("creditUsed" * 100) AS INTEGER) - ${releasedCents}) / 100.0
          WHERE id = ${input.context.transaction.accountId}
        `;
      }
      return toVerificationView(verification);
    });
  }

  async markUnderReviewAtomically(input: Parameters<TransactionVerificationPersistencePort["markUnderReviewAtomically"]>[0]) {
    if (input.context.verification.status === VerificationStatus.UNDER_REVIEW &&
        input.context.verification.reviewReason === input.reason) {
      return input.context.verification;
    }
    try {
      return await this.prisma.$transaction(async (database) => {
        const claimed = await database.transactionVerification.updateMany({
          where: {
            id: input.context.verification.id,
            version: input.context.verification.version,
            status: { in: [VerificationStatus.UNDER_REVIEW, VerificationStatus.AUTOMATICALLY_VERIFIED] },
          },
          data: {
            status: VerificationStatus.UNDER_REVIEW,
            requiresManualReview: true,
            reviewReason: input.reason,
            decidedBy: input.administratorId,
            decidedAt: input.reviewedAt,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) {
          throw conflict("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta o cambio concurrentemente");
        }
        await database.verificationDecisionAudit.create({
          data: {
            verificationId: input.context.verification.id,
            previousStatus: input.context.verification.status,
            resultingStatus: VerificationStatus.UNDER_REVIEW,
            decision: "REVIEW",
            administratorUserId: input.administratorId,
            reviewReason: input.reason,
            createdAt: input.reviewedAt,
          },
        });
        const verification = await database.transactionVerification.findUniqueOrThrow({
          where: { id: input.context.verification.id },
        });
        return toVerificationView(verification);
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (isTransactionConflict(error)) {
        throw conflict("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta o cambio concurrentemente");
      }
      throw error;
    }
  }

  async rejectAtomically(input: Parameters<TransactionVerificationPersistencePort["rejectAtomically"]>[0]) {
    return this.decide(input.context, async (database) => {
      await database.verificationDecisionAudit.create({
        data: {
          verificationId: input.context.verification.id,
          previousStatus: input.context.verification.status,
          resultingStatus: VerificationStatus.REJECTED,
          decision: "REJECT",
          administratorUserId: input.administratorId,
          rejectionReason: input.reason,
          createdAt: input.decidedAt,
        },
      });
      const verification = await database.transactionVerification.update({
        where: { id: input.context.verification.id },
        data: {
          status: VerificationStatus.REJECTED, decidedBy: input.administratorId, decidedAt: input.decidedAt,
          reviewReason: null, rejectionReason: input.reason, version: input.context.verification.version + 1,
        },
      });
      const paymentStatus = input.context.transaction.accountTypeSnapshot === AccountType.POSTPAID
        ? postpaidStatusAfterRejectedReceipt(input.context.payment.dueDate, input.decidedAt)
        : "REJECTED";
      await database.payment.update({
        where: { id: input.context.payment.id },
        data: { status: paymentStatus, version: { increment: 1 } },
      });
      await database.paymentReceipt.update({
        where: { id: input.context.receipt.id },
        data: { status: "REJECTED", version: { increment: 1 } },
      });
      // The recharge is deliberately not authorized. It remains auditable and
      // can continue only through the receipt-regularization flow.
      return toVerificationView(verification);
    });
  }

  async loadPaymentForReceipt(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, status: true, version: true, transaction: { select: { clientId: true } } },
    });
    return payment ? { id: payment.id, clientId: payment.transaction.clientId, status: payment.status, version: payment.version } : null;
  }

  async saveUploadedReceipt(input: Parameters<PaymentReceiptPersistencePort["saveUploadedReceipt"]>[0]) {
    return this.prisma.$transaction(async (database) => {
      const claimed = await database.payment.updateMany({
        where: { id: input.paymentId, version: input.expectedPaymentVersion, status: { not: "PAID" } },
        data: { status: "UNDER_REVIEW", version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw conflict("PAYMENT_DOES_NOT_ACCEPT_RECEIPT", "El pago ya no admite comprobantes");
      const receipt = await database.paymentReceipt.create({ data: { ...input.receipt, paymentId: input.paymentId, status: "LOADED" } });
      return toReceiptSnapshot(receipt);
    });
  }

  private async findExistingVerification(receiptId: string) {
    const record = await this.prisma.transactionVerification.findUnique({ where: { receiptId } });
    return record ? toVerificationView(record) : null;
  }

  private async decide(
    context: VerificationDecisionContext,
    decision: (database: Prisma.TransactionClient) => Promise<TransactionVerificationView>,
  ): Promise<TransactionVerificationView> {
    try {
      return await this.prisma.$transaction(async (database) => {
        const verification = await database.transactionVerification.updateMany({
          where: {
            id: context.verification.id,
            version: context.verification.version,
            status: { in: [VerificationStatus.UNDER_REVIEW, VerificationStatus.AUTOMATICALLY_VERIFIED] },
          },
          // This compare-and-swap is the write lock. It prevents two admin
          // decisions loaded from the same version from both becoming valid.
          data: { version: { increment: 1 } },
        });
        const payment = await database.payment.count({
          where: { id: context.payment.id, version: context.payment.version, status: "UNDER_REVIEW" },
        });
        const transaction = await database.rechargeTransaction.count({
          where: {
            id: context.transaction.id,
            version: context.transaction.version,
            ...(context.transaction.accountTypeSnapshot === AccountType.PREPAID
              ? { rechargeStatus: "UNDER_REVIEW" }
              : { rechargeStatus: { in: ["APPROVED", "PROCESSING", "COMPLETED"] } }),
          },
        });
        const receipt = await database.paymentReceipt.count({
          where: { id: context.receipt.id, version: context.receipt.version, status: { in: ["PROCESSED", "FAILED"] } },
        });
        if (verification.count !== 1 || payment !== 1 || transaction !== 1 || receipt !== 1) {
          throw conflict("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta o cambio concurrentemente");
        }
        return decision(database);
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (isUniqueError(error)) {
        throw conflict("PAYMENT_EVIDENCE_ALREADY_CONFIRMED", "El comprobante, pago o codigo bancario ya fue confirmado");
      }
      if (isTransactionConflict(error)) {
        throw conflict("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta o cambio concurrentemente");
      }
      throw error;
    }
  }
}

async function claimReceipt(
  database: Prisma.TransactionClient,
  receipt: TransactionReceiptSnapshot,
  status: "PROCESSED" | "FAILED",
) {
  const claimed = await database.paymentReceipt.updateMany({
    where: { id: receipt.id, version: receipt.version, status: { in: ["LOADED", "PROCESSING"] } },
    data: { status, version: { increment: 1 } },
  });
  if (claimed.count !== 1) throw conflict("RECEIPT_ALREADY_PROCESSED", "El comprobante ya fue procesado o cambio concurrentemente");
}

async function assertProcessingContext(database: Prisma.TransactionClient, context: ReceiptProcessingContext) {
  const [payment, transaction] = await Promise.all([
    database.payment.count({
      where: {
        id: context.payment.id,
        transactionId: context.transaction.id,
        version: context.payment.version,
        status: context.payment.status,
      },
    }),
    database.rechargeTransaction.count({
      where: { id: context.transaction.id, version: context.transaction.version, rechargeStatus: context.transaction.status },
    }),
  ]);
  if (payment !== 1 || transaction !== 1) {
    throw conflict("RECEIPT_PROCESSING_CONFLICT", "El pago o la transaccion cambio mientras se procesaba el comprobante");
  }
}

function toReceiptSnapshot(record: {
  id: string; paymentId: string; originalName: string; mimeType: string; size: number;
  url: string; checksum: string; status: string; version: number;
}): TransactionReceiptSnapshot {
  return { ...record, status: record.status as TransactionReceiptSnapshot["status"] };
}

function toVerificationView(record: {
  id: string; transactionId: string; paymentId: string; receiptId: string; ocrResultId: string | null;
  status: string; expectedAmount: Prisma.Decimal; detectedAmount: Prisma.Decimal | null; amountMatches: boolean | null;
  issues: string; requiresManualReview: boolean; decidedBy: string | null; decidedAt: Date | null;
  reviewReason: string | null; rejectionReason: string | null; version: number;
}): TransactionVerificationView {
  let issues: readonly TransactionVerificationIssue[] = [];
  try { issues = JSON.parse(record.issues) as TransactionVerificationIssue[]; } catch { issues = []; }
  return {
    id: record.id, transactionId: record.transactionId, paymentId: record.paymentId,
    receiptId: record.receiptId, ocrResultId: record.ocrResultId,
    status: record.status as TransactionVerificationStatus,
    expectedAmount: decimalToNumber(record.expectedAmount),
    detectedAmount: record.detectedAmount === null ? null : decimalToNumber(record.detectedAmount),
    amountMatches: record.amountMatches, issues, requiresManualReview: record.requiresManualReview,
    decidedBy: record.decidedBy, decidedAt: record.decidedAt?.toISOString() ?? null,
    reviewReason: record.reviewReason, rejectionReason: record.rejectionReason, version: record.version,
  };
}

function toExtractedData(record: {
  bank: string | null; detectedAmount: Prisma.Decimal | null; detectedDate: Date | null;
  detectedTransactionCode: string | null; originator: string | null; confidence: Prisma.Decimal | null; rawText: string | null;
}): ExtractedTransactionReceiptData {
  return {
    bank: record.bank,
    detectedAmount: record.detectedAmount === null ? null : decimalToNumber(record.detectedAmount),
    detectedDate: record.detectedDate,
    transactionCode: record.detectedTransactionCode,
    originator: record.originator,
    confidence: record.confidence === null ? null : decimalToNumber(record.confidence),
    rawText: record.rawText,
  };
}

function toOcrCreate(
  id: string,
  receiptId: string,
  extracted: ExtractedTransactionReceiptData,
  failureReason: string | null,
) {
  return {
    id, receiptId, bank: extracted.bank, detectedAmount: decimalOrNull(extracted.detectedAmount),
    detectedDate: extracted.detectedDate, detectedTransactionCode: extracted.transactionCode,
    originator: extracted.originator, confidence: decimalOrNull(extracted.confidence), rawText: extracted.rawText, failureReason,
  };
}

function emptyExtractedData(): ExtractedTransactionReceiptData {
  return { bank: null, detectedAmount: null, detectedDate: null, transactionCode: null, originator: null, confidence: null, rawText: null };
}

async function findConfirmedDuplicatesInTransaction(
  database: Prisma.TransactionClient,
  input: { excludePaymentId: string; checksum: string; transactionCode: string | null },
): Promise<DuplicatePaymentEvidence> {
  const receipt = await database.confirmedPaymentEvidence.findFirst({
    where: { receiptChecksum: input.checksum, paymentId: { not: input.excludePaymentId } },
    select: { id: true },
  });
  const normalizedCode = normalizeBankReference(input.transactionCode);
  const code = normalizedCode ? await database.confirmedPaymentEvidence.findFirst({
    where: { bankReferenceNormalized: normalizedCode, paymentId: { not: input.excludePaymentId } },
    select: { id: true },
  }) : null;
  return { checksumUsed: receipt !== null, transactionCodeUsed: code !== null };
}

function decimalOrNull(value: number | null) { return value === null ? null : new Prisma.Decimal(value); }
function decimalToNumber(value: Prisma.Decimal) { return Number(value.toFixed(2)); }
export function normalizeBankReference(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized || null;
}
function postpaidStatusAfterRejectedReceipt(dueDate: Date | null, decidedAt: Date) {
  return dueDate && dueDate.getTime() < decidedAt.getTime() ? "OVERDUE" : "IN_CREDIT";
}
function conflict(code: string, message: string) { return new ApplicationError(code, message, 409); }
function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
function isTransactionConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2025", "P2028", "P2034"].includes(error.code);
}
