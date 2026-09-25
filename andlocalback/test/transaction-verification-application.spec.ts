import { describe, expect, it, vi } from "vitest";
import {
  DuplicatePaymentEvidence,
  ReceiptProcessingContext,
  TransactionVerificationPersistencePort,
  TransactionVerificationView,
  VerificationDecisionContext,
} from "../src/modules/recharges/application/ports/transaction-verification.ports";
import { ApproveTransactionVerification } from "../src/modules/recharges/application/use-cases/approve-transaction-verification";
import { ProcessTransactionReceiptOcr } from "../src/modules/recharges/application/use-cases/process-transaction-receipt-ocr";
import { RejectTransactionVerification } from "../src/modules/recharges/application/use-cases/reject-transaction-verification";
import { MarkTransactionVerificationUnderReview } from "../src/modules/recharges/application/use-cases/mark-transaction-verification-under-review";
import { UploadPaymentReceipt } from "../src/modules/recharges/application/use-cases/upload-payment-receipt";
import { AccountType, VerificationIssue, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";

const fixedDate = new Date("2026-09-09T12:00:00.000Z");

function verification(overrides: Partial<TransactionVerificationView> = {}): TransactionVerificationView {
  return {
    id: "verification-1", transactionId: "transaction-1", paymentId: "payment-1", receiptId: "receipt-1",
    ocrResultId: "ocr-1", status: VerificationStatus.UNDER_REVIEW, expectedAmount: 1058,
    detectedAmount: 1058, amountMatches: true, issues: [], requiresManualReview: true,
    decidedBy: null, decidedAt: null, reviewReason: null, rejectionReason: null, version: 0, ...overrides,
  };
}

function receiptContext(existingVerification: TransactionVerificationView | null = null): ReceiptProcessingContext {
  return {
    transaction: { id: "transaction-1", accountId: "account-1", status: "UNDER_REVIEW", version: 2 },
    payment: { id: "payment-1", transactionId: "transaction-1", status: "UNDER_REVIEW", expectedAmount: 1058, version: 3 },
    receipt: {
      id: "receipt-1", paymentId: "payment-1", originalName: "transfer.png", mimeType: "image/png",
      size: 100, url: "/receipts/transfer.png", checksum: "sha-1", status: "LOADED", version: 0,
    },
    existingVerification,
  };
}

function decisionContext(overrides: Partial<VerificationDecisionContext> = {}): VerificationDecisionContext {
  return {
    transaction: {
      id: "transaction-1", accountId: "account-1", accountTypeSnapshot: AccountType.PREPAID,
      status: TransactionRechargeStatus.UNDER_REVIEW, version: 2,
    },
    payment: { id: "payment-1", status: TransactionPaymentStatus.UNDER_REVIEW, expectedAmount: 1058, dueDate: null, version: 3 },
    receipt: { ...receiptContext().receipt, status: "PROCESSED", version: 1 },
    ocr: {
      bank: "Banco Local", detectedAmount: 1058, detectedDate: fixedDate,
      transactionCode: "BANK-123", originator: "Cliente", confidence: 98, rawText: "transferencia",
    },
    verification: verification(),
    ...overrides,
  };
}

class MemoryVerificationPersistence implements TransactionVerificationPersistencePort {
  receipt: ReceiptProcessingContext | null = receiptContext();
  decision: VerificationDecisionContext | null = decisionContext();
  duplicates: DuplicatePaymentEvidence = { checksumUsed: false, transactionCodeUsed: false };
  savedEvaluation: Parameters<TransactionVerificationPersistencePort["saveOcrEvaluation"]>[0] | null = null;
  savedFailure: Parameters<TransactionVerificationPersistencePort["saveOcrFailure"]>[0] | null = null;
  approved: Parameters<TransactionVerificationPersistencePort["approveAtomically"]>[0] | null = null;
  rejected: Parameters<TransactionVerificationPersistencePort["rejectAtomically"]>[0] | null = null;
  markedUnderReview: Parameters<TransactionVerificationPersistencePort["markUnderReviewAtomically"]>[0] | null = null;

  async loadReceiptContext() { return this.receipt; }
  async loadVerificationContext() { return this.decision; }
  async findConfirmedDuplicates() { return this.duplicates; }
  async saveOcrEvaluation(input: Parameters<TransactionVerificationPersistencePort["saveOcrEvaluation"]>[0]) {
    this.savedEvaluation = input;
    return verification({
      id: input.verificationId,
      ocrResultId: input.ocrResultId,
      status: input.evaluation.status,
      detectedAmount: input.extracted.detectedAmount,
      amountMatches: input.evaluation.amountMatches,
      issues: input.evaluation.issues,
    });
  }
  async saveOcrFailure(input: Parameters<TransactionVerificationPersistencePort["saveOcrFailure"]>[0]) {
    this.savedFailure = input;
    return verification({ id: input.verificationId, ocrResultId: input.ocrResultId, detectedAmount: null, amountMatches: null,
      issues: [VerificationIssue.OCR_FAILURE], status: VerificationStatus.UNDER_REVIEW });
  }
  async approveAtomically(input: Parameters<TransactionVerificationPersistencePort["approveAtomically"]>[0]) {
    this.approved = input;
    return verification({ status: VerificationStatus.APPROVED, decidedBy: input.administratorId, decidedAt: input.decidedAt.toISOString() });
  }
  async rejectAtomically(input: Parameters<TransactionVerificationPersistencePort["rejectAtomically"]>[0]) {
    this.rejected = input;
    return verification({ status: VerificationStatus.REJECTED, decidedBy: input.administratorId,
      decidedAt: input.decidedAt.toISOString(), rejectionReason: input.reason });
  }
  async markUnderReviewAtomically(input: Parameters<TransactionVerificationPersistencePort["markUnderReviewAtomically"]>[0]) {
    this.markedUnderReview = input;
    return verification({
      status: VerificationStatus.UNDER_REVIEW,
      reviewReason: input.reason,
      decidedBy: input.administratorId,
      decidedAt: input.reviewedAt.toISOString(),
      version: 1,
    });
  }
}

describe("ProcessTransactionReceiptOcr", () => {
  it("guarda OCR enriquecido y crea una verificacion automatica sin confirmar el pago", async () => {
    const persistence = new MemoryVerificationPersistence();
    const process = vi.fn().mockResolvedValue({
      originalText: "Banco Local 1058.00 BANK-123", confidence: 98,
      detectedAmounts: [MonetaryAmount.fromMajorUnits(1058)], bank: "Banco Local",
      transactionDate: fixedDate, bankReference: "BANK-123", orderingParty: "Cliente",
    });
    const ids = ["ocr-new", "verification-new"];
    const realtime = { publishVerification: vi.fn() };
    const useCase = new ProcessTransactionReceiptOcr(
      persistence, { process }, { generate: () => ids.shift()! }, undefined, () => fixedDate, realtime,
    );

    const result = await useCase.execute({ receiptId: "receipt-1" });

    expect(result.status).toBe(VerificationStatus.AUTOMATICALLY_VERIFIED);
    expect(persistence.savedEvaluation?.extracted).toMatchObject({
      bank: "Banco Local", detectedAmount: 1058, transactionCode: "BANK-123", confidence: 98,
    });
    expect(persistence.savedEvaluation?.evaluation.issues).toEqual([]);
    expect(persistence.savedFailure).toBeNull();
    expect(persistence.receipt?.payment.status).toBe("UNDER_REVIEW");
    expect(realtime.publishVerification).toHaveBeenCalledWith({
      eventId: "verification-new:0", verificationId: "verification-new", transactionId: "transaction-1",
      accountId: "account-1", status: VerificationStatus.AUTOMATICALLY_VERIFIED,
      paymentStatus: "UNDER_REVIEW", rechargeStatus: "UNDER_REVIEW", reason: null, version: 0,
      occurredAt: fixedDate.toISOString(),
    });
  });

  it("envia a revision cuando checksum o codigo ya confirmaron otro pago", async () => {
    const persistence = new MemoryVerificationPersistence();
    persistence.duplicates = { checksumUsed: true, transactionCodeUsed: true };
    const useCase = new ProcessTransactionReceiptOcr(persistence, { process: async () => ({
      originalText: "ok", confidence: 99, detectedAmounts: [MonetaryAmount.fromMajorUnits(1058)],
      bank: "Banco", transactionDate: fixedDate, bankReference: "BANK-123", orderingParty: null,
    }) }, { generate: () => "id" }, undefined, () => fixedDate);

    const result = await useCase.execute({ receiptId: "receipt-1" });

    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
    expect(result.issues).toEqual(expect.arrayContaining([
      VerificationIssue.DUPLICATE_RECEIPT, VerificationIssue.DUPLICATE_BANK_REFERENCE,
    ]));
  });

  it("registra el fallo OCR y mantiene el pago en revision", async () => {
    const persistence = new MemoryVerificationPersistence();
    const realtime = { publishVerification: vi.fn() };
    const useCase = new ProcessTransactionReceiptOcr(
      persistence, { process: async () => { throw new Error("PDF no soportado"); } }, { generate: () => "id" },
      undefined, () => fixedDate, realtime,
    );

    const result = await useCase.execute({ receiptId: "receipt-1" });

    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
    expect(persistence.savedFailure?.failureReason).toBe("PDF no soportado");
    expect(persistence.receipt?.payment.status).toBe("UNDER_REVIEW");
    expect(realtime.publishVerification).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: "id", accountId: "account-1", status: VerificationStatus.UNDER_REVIEW,
      reason: "No fue posible leer el comprobante automáticamente",
    }));
  });

  it("es idempotente cuando el comprobante ya tiene verificacion", async () => {
    const existing = verification({ id: "winner" });
    const persistence = new MemoryVerificationPersistence();
    persistence.receipt = receiptContext(existing);
    const process = vi.fn();
    const result = await new ProcessTransactionReceiptOcr(persistence, { process }, { generate: () => "unused" })
      .execute({ receiptId: "receipt-1" });
    expect(result).toBe(existing);
    expect(process).not.toHaveBeenCalled();
  });
});

describe("ApproveTransactionVerification", () => {
  it("delega la aprobacion financiera atomica despues de revalidar antifraude", async () => {
    const persistence = new MemoryVerificationPersistence();
    const realtime = { publishVerification: vi.fn() };
    const result = await new ApproveTransactionVerification(persistence, () => fixedDate, realtime).execute({
      verificationId: "verification-1", administratorId: "admin-1", notes: "Validado",
    });
    expect(result.status).toBe(VerificationStatus.APPROVED);
    expect(persistence.approved).toMatchObject({ administratorId: "admin-1", notes: "Validado", decidedAt: fixedDate });
    expect(realtime.publishVerification).toHaveBeenCalledWith(expect.objectContaining({ verificationId: "verification-1", status: VerificationStatus.APPROVED, paymentStatus: "PAID" }));
  });

  it.each([
    [{ checksumUsed: true, transactionCodeUsed: false }, "RECEIPT_ALREADY_CONFIRMED"],
    [{ checksumUsed: false, transactionCodeUsed: true }, "BANK_REFERENCE_ALREADY_CONFIRMED"],
  ])("bloquea evidencia reutilizada", async (duplicates, code) => {
    const persistence = new MemoryVerificationPersistence();
    persistence.duplicates = duplicates;
    await expect(new ApproveTransactionVerification(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1",
    })).rejects.toMatchObject({ code });
    expect(persistence.approved).toBeNull();
  });

  it.each([false, null])("permite al administrador resolver manualmente amountMatches=%s", async (amountMatches) => {
    const persistence = new MemoryVerificationPersistence();
    persistence.decision = decisionContext({ verification: verification({ amountMatches }) });
    const result = await new ApproveTransactionVerification(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1",
    });
    expect(result.status).toBe(VerificationStatus.APPROVED);
    expect(persistence.approved?.context.verification.amountMatches).toBe(amountMatches);
  });
});

describe("RejectTransactionVerification", () => {
  it("delega rechazo atomico conservando la recarga sin autorizar", async () => {
    const persistence = new MemoryVerificationPersistence();
    const realtime = { publishVerification: vi.fn() };
    const result = await new RejectTransactionVerification(persistence, () => fixedDate, realtime).execute({
      verificationId: "verification-1", administratorId: "admin-1", reason: "Documento alterado",
    });
    expect(result).toMatchObject({ status: VerificationStatus.REJECTED, rejectionReason: "Documento alterado" });
    expect(persistence.rejected?.context.transaction.status).toBe("UNDER_REVIEW");
    expect(realtime.publishVerification).toHaveBeenCalledWith(expect.objectContaining({ verificationId: "verification-1", status: VerificationStatus.REJECTED, paymentStatus: "REJECTED" }));
  });

  it("impide resolver dos veces la misma verificacion", async () => {
    const persistence = new MemoryVerificationPersistence();
    persistence.decision = decisionContext({ verification: verification({ status: VerificationStatus.APPROVED }) });
    await expect(new RejectTransactionVerification(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1", reason: "No aplica",
    })).rejects.toMatchObject({ code: "VERIFICATION_ALREADY_RESOLVED" });
  });
});

describe("MarkTransactionVerificationUnderReview", () => {
  it("envia una verificacion automatica a revision sin decidir pago, comprobante ni recarga", async () => {
    const persistence = new MemoryVerificationPersistence();
    persistence.decision = decisionContext({
      verification: verification({ status: VerificationStatus.AUTOMATICALLY_VERIFIED }),
    });
    const realtime = { publishVerification: vi.fn() };

    const result = await new MarkTransactionVerificationUnderReview(persistence, () => fixedDate, realtime).execute({
      verificationId: " verification-1 ", administratorId: " admin-1 ", reason: " Datos incompletos ",
    });

    expect(result).toMatchObject({ status: VerificationStatus.UNDER_REVIEW, reviewReason: "Datos incompletos" });
    expect(persistence.markedUnderReview).toMatchObject({
      administratorId: "admin-1", reason: "Datos incompletos", reviewedAt: fixedDate,
    });
    expect(persistence.approved).toBeNull();
    expect(persistence.rejected).toBeNull();
    expect(realtime.publishVerification).toHaveBeenCalledWith({
      eventId: "verification-1:1", verificationId: "verification-1", transactionId: "transaction-1",
      accountId: "account-1", status: VerificationStatus.UNDER_REVIEW,
      paymentStatus: "UNDER_REVIEW", rechargeStatus: "UNDER_REVIEW",
      reason: "Datos incompletos", version: 1, occurredAt: fixedDate.toISOString(),
    });
  });

  it("es idempotente si el estado y el motivo ya coinciden", async () => {
    const persistence = new MemoryVerificationPersistence();
    const existing = verification({ status: VerificationStatus.UNDER_REVIEW, reviewReason: "Validar banco", version: 4 });
    persistence.decision = decisionContext({ verification: existing });

    const result = await new MarkTransactionVerificationUnderReview(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1", reason: "Validar banco",
    });

    expect(result).toBe(existing);
    expect(persistence.markedUnderReview).toBeNull();
  });

  it("requiere motivo y no reabre una verificacion resuelta", async () => {
    const persistence = new MemoryVerificationPersistence();
    await expect(new MarkTransactionVerificationUnderReview(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1", reason: " ",
    })).rejects.toMatchObject({ code: "REVIEW_REASON_REQUIRED" });

    persistence.decision = decisionContext({ verification: verification({ status: VerificationStatus.APPROVED }) });
    await expect(new MarkTransactionVerificationUnderReview(persistence).execute({
      verificationId: "verification-1", administratorId: "admin-1", reason: "Reabrir",
    })).rejects.toMatchObject({ code: "VERIFICATION_ALREADY_RESOLVED" });
  });
});

describe("UploadPaymentReceipt", () => {
  it("permite regularizar un pago rechazado sin ejecutar OCR implicitamente", async () => {
    let saved: Parameters<import("../src/modules/recharges/application/ports/transaction-verification.ports").PaymentReceiptPersistencePort["saveUploadedReceipt"]>[0] | null = null;
    const persistence = {
      loadPaymentForReceipt: async () => ({ id: "payment-1", clientId: "client-1", status: "REJECTED", version: 4 }),
      saveUploadedReceipt: async (input: NonNullable<typeof saved>) => {
        saved = input;
        return { ...input.receipt, paymentId: input.paymentId, status: "LOADED" as const, version: 0 };
      },
    };
    const process = vi.fn().mockResolvedValue({
      id: "receipt-new", originalName: "new.png", mimeType: "image/png", size: 10,
      url: "/receipts/new.png", checksum: "sha-new",
    });
    const result = await new UploadPaymentReceipt(persistence, { process }).execute({
      paymentId: "payment-1", clientId: "client-1",
      file: { originalName: "new.png", mimeType: "image/png", size: 10, buffer: Buffer.from("image") },
    });

    expect(result).toMatchObject({ id: "receipt-new", status: "LOADED" });
    expect(saved).toMatchObject({ paymentId: "payment-1", expectedPaymentVersion: 4 });
    expect(process).toHaveBeenCalledOnce();
  });

  it("rechaza comprobantes adicionales para un pago confirmado antes de almacenar el archivo", async () => {
    const process = vi.fn();
    const useCase = new UploadPaymentReceipt({
      loadPaymentForReceipt: async () => ({ id: "payment-1", clientId: "client-1", status: "PAID", version: 1 }),
      saveUploadedReceipt: async () => { throw new Error("unexpected"); },
    }, { process });
    await expect(useCase.execute({
      paymentId: "payment-1", clientId: "client-1",
      file: { originalName: "new.png", mimeType: "image/png", size: 10, buffer: Buffer.from("image") },
    })).rejects.toMatchObject({ code: "PAYMENT_ALREADY_CONFIRMED" });
    expect(process).not.toHaveBeenCalled();
  });
});
