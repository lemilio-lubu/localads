import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import { PrismaService } from "../src/database/prisma.service";
import { VerificationIssue, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { PrismaTransactionVerificationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-transaction-verification.repository";

describe("PrismaTransactionVerificationRepository", () => {
  let directory: string;
  let prisma: PrismaClient;
  let repository: PrismaTransactionVerificationRepository;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-phase3-"));
    const databasePath = join(directory, "phase3.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    repository = new PrismaTransactionVerificationRepository(prisma as PrismaService);
    await prisma.client.create({ data: { id: "p3-client", name: "Phase 3", email: "phase3@example.test", status: "ACTIVE" } });
    await prisma.account.create({ data: { id: "p3-account", clientId: "p3-client", type: "PREPAGO", status: "ACTIVE" } });
    await prisma.pauta.create({ data: { id: "p3-pauta", clientId: "p3-client", platform: "META", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("guarda OCR, verificacion y estado del comprobante atomicamente e idempotente", async () => {
    await createPending("ocr", "hash-ocr");
    const context = (await repository.loadReceiptContext("receipt-ocr"))!;
    const input = {
      context,
      ocrResultId: "ocr-ocr",
      verificationId: "verification-ocr",
      extracted: extracted("BANK-001"),
      evaluation: {
        status: VerificationStatus.AUTOMATICALLY_VERIFIED,
        amountMatches: true,
        issues: [] as VerificationIssue[],
        requiresManualReview: false,
      },
    };

    const first = await repository.saveOcrEvaluation(input);
    const retry = await repository.saveOcrEvaluation(input);

    expect(retry.id).toBe(first.id);
    expect(await prisma.ocrResult.count({ where: { receiptId: "receipt-ocr" } })).toBe(1);
    expect(await prisma.transactionVerification.count({ where: { receiptId: "receipt-ocr" } })).toBe(1);
    expect((await prisma.paymentReceipt.findUnique({ where: { id: "receipt-ocr" } }))?.status).toBe("PROCESSED");
  });

  it("un fallo OCR crea revision humana sin rechazar el pago", async () => {
    await createPending("failure", "hash-failure");
    const context = (await repository.loadReceiptContext("receipt-failure"))!;
    const verification = await repository.saveOcrFailure({
      context, ocrResultId: "ocr-failure", verificationId: "verification-failure", failureReason: "imagen ilegible",
    });

    expect(verification.status).toBe(VerificationStatus.UNDER_REVIEW);
    expect(verification.issues).toEqual([VerificationIssue.OCR_FAILURE, VerificationIssue.AMOUNT_NOT_FOUND]);
    expect((await prisma.payment.findUnique({ where: { id: "payment-failure" } }))?.status).toBe("UNDER_REVIEW");
    expect((await prisma.paymentReceipt.findUnique({ where: { id: "receipt-failure" } }))?.status).toBe("FAILED");
  });

  it("carga un comprobante adicional con compare-and-swap sobre el pago", async () => {
    await createPending("upload", "hash-original");
    const payment = (await repository.loadPaymentForReceipt("payment-upload"))!;
    const receipt = await repository.saveUploadedReceipt({
      paymentId: payment.id,
      expectedPaymentVersion: payment.version,
      receipt: { id: "receipt-upload-2", originalName: "nuevo.pdf", mimeType: "application/pdf", size: 42, url: "/nuevo.pdf", checksum: "hash-nuevo" },
    });

    expect(receipt).toMatchObject({ id: "receipt-upload-2", paymentId: "payment-upload", status: "LOADED", version: 0 });
    await expect(repository.saveUploadedReceipt({
      paymentId: payment.id,
      expectedPaymentVersion: payment.version,
      receipt: { id: "receipt-upload-3", originalName: "otro.pdf", mimeType: "application/pdf", size: 42, url: "/otro.pdf", checksum: "hash-otro" },
    })).rejects.toMatchObject({ code: "PAYMENT_DOES_NOT_ACCEPT_RECEIPT" });
  });

  it("detecta checksum y codigo bancario usados solo en pagos confirmados y excluye el pago actual", async () => {
    await createPending("confirmed", "shared-hash");
    await evaluate("confirmed", "SHARED-CODE");
    const decision = (await repository.loadVerificationContext("verification-confirmed"))!;
    await repository.approveAtomically({
      context: decision,
      administratorId: "admin",
      notes: "Comprobante revisado manualmente",
      decidedAt: new Date(),
    });
    expect((await prisma.transactionVerification.findUnique({
      where: { id: "verification-confirmed" },
    }))?.decisionNotes).toBe("Comprobante revisado manualmente");
    expect(await prisma.confirmedPaymentEvidence.findUnique({ where: { verificationId: "verification-confirmed" } })).toMatchObject({
      receiptChecksum: "shared-hash", bankReferenceNormalized: "SHAREDCODE",
    });
    expect(await prisma.verificationDecisionAudit.findFirst({ where: { verificationId: "verification-confirmed" } })).toMatchObject({
      decision: "APPROVE", previousStatus: VerificationStatus.UNDER_REVIEW,
      resultingStatus: VerificationStatus.APPROVED, administratorUserId: "admin",
    });
    await createPending("candidate", "shared-hash");

    expect(await repository.findConfirmedDuplicates({
      excludePaymentId: "payment-candidate", checksum: "shared-hash", transactionCode: " shared-code ",
    })).toEqual({ checksumUsed: true, transactionCodeUsed: true });
    expect(await repository.findConfirmedDuplicates({
      excludePaymentId: "payment-confirmed", checksum: "shared-hash", transactionCode: "SHARED-CODE",
    })).toEqual({ checksumUsed: false, transactionCodeUsed: false });
  });

  it("aprueba una sola decision concurrente y actualiza pago, transaccion y detalles", async () => {
    await createPending("race", "hash-race");
    await evaluate("race", "RACE-1");
    const context = (await repository.loadVerificationContext("verification-race"))!;
    const results = await Promise.allSettled([
      repository.approveAtomically({ context, administratorId: "admin-a", notes: null, decidedAt: new Date() }),
      repository.rejectAtomically({ context, administratorId: "admin-b", reason: "rechazo concurrente", decidedAt: new Date() }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    expect(rejection.reason).toBeInstanceOf(ApplicationError);
    expect(rejection.reason.code).toBe("VERIFICATION_ALREADY_RESOLVED");
    const verification = await prisma.transactionVerification.findUnique({ where: { id: "verification-race" } });
    const payment = await prisma.payment.findUnique({ where: { id: "payment-race" } });
    if (verification?.status === VerificationStatus.APPROVED) {
      expect(payment?.status).toBe("PAID");
      expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-race" } }))?.rechargeStatus).toBe("APPROVED");
      expect((await prisma.transactionDetail.findUnique({ where: { id: "detail-race" } }))?.status).toBe("APPROVED");
    } else {
      expect(verification?.status).toBe(VerificationStatus.REJECTED);
      expect(payment?.status).toBe("REJECTED");
      expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-race" } }))?.rechargeStatus).toBe("UNDER_REVIEW");
    }
  });

  it("confirma una sola evidencia cuando dos pagos compiten con la misma referencia normalizada", async () => {
    await createPending("evidence-a", "hash-evidence-a");
    await createPending("evidence-b", "hash-evidence-b");
    await evaluate("evidence-a", "CONCURRENT-777");
    await evaluate("evidence-b", " concurrent 777 ");
    const contextA = (await repository.loadVerificationContext("verification-evidence-a"))!;
    const contextB = (await repository.loadVerificationContext("verification-evidence-b"))!;
    const results = await Promise.allSettled([
      repository.approveAtomically({ context: contextA, administratorId: "admin-a", notes: null, decidedAt: new Date() }),
      repository.approveAtomically({ context: contextB, administratorId: "admin-b", notes: null, decidedAt: new Date() }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.confirmedPaymentEvidence.count({ where: { bankReferenceNormalized: "CONCURRENT777" } })).toBe(1);
    expect(await prisma.verificationDecisionAudit.count({ where: { verificationId: { in: ["verification-evidence-a", "verification-evidence-b"] } } })).toBe(1);
  });

  it("rechaza atomicamente sin autorizar la transaccion", async () => {
    await createPending("reject", "hash-reject");
    await evaluate("reject", "REJECT-1");
    const context = (await repository.loadVerificationContext("verification-reject"))!;
    const result = await repository.rejectAtomically({
      context, administratorId: "admin", reason: "evidencia invalida", decidedAt: new Date(),
    });

    expect(result.status).toBe(VerificationStatus.REJECTED);
    expect((await prisma.payment.findUnique({ where: { id: "payment-reject" } }))?.status).toBe("REJECTED");
    expect((await prisma.paymentReceipt.findUnique({ where: { id: "receipt-reject" } }))?.status).toBe("REJECTED");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-reject" } }))?.rechargeStatus).toBe("UNDER_REVIEW");
    expect((await prisma.transactionDetail.findUnique({ where: { id: "detail-reject" } }))?.status).toBe("REQUESTED");
    expect(await prisma.verificationDecisionAudit.findFirst({ where: { verificationId: "verification-reject" } })).toMatchObject({
      decision: "REJECT", resultingStatus: VerificationStatus.REJECTED,
      rejectionReason: "evidencia invalida", administratorUserId: "admin",
    });
  });

  it("registra historial de revision sin modificar pago, comprobante ni recarga", async () => {
    await createPending("review", "hash-review");
    await evaluate("review", "REVIEW-1");
    const automatic = await prisma.transactionVerification.update({
      where: { id: "verification-review" },
      data: { status: VerificationStatus.AUTOMATICALLY_VERIFIED },
    });
    const context = (await repository.loadVerificationContext(automatic.id))!;

    const first = await repository.markUnderReviewAtomically({
      context, administratorId: "admin-a", reason: "Validar referencia", reviewedAt: new Date("2026-09-11T12:00:00.000Z"),
    });
    const secondContext = (await repository.loadVerificationContext(automatic.id))!;
    const second = await repository.markUnderReviewAtomically({
      context: secondContext, administratorId: "admin-b", reason: "Validar titular", reviewedAt: new Date("2026-09-11T12:01:00.000Z"),
    });

    expect(first).toMatchObject({ status: VerificationStatus.UNDER_REVIEW, reviewReason: "Validar referencia" });
    expect(second).toMatchObject({ status: VerificationStatus.UNDER_REVIEW, reviewReason: "Validar titular" });
    expect(await prisma.verificationDecisionAudit.count({ where: { verificationId: automatic.id } })).toBe(2);
    expect(await prisma.verificationDecisionAudit.findMany({
      where: { verificationId: automatic.id }, orderBy: { createdAt: "asc" }, select: { decision: true, reviewReason: true },
    })).toEqual([
      { decision: "REVIEW", reviewReason: "Validar referencia" },
      { decision: "REVIEW", reviewReason: "Validar titular" },
    ]);
    expect((await prisma.payment.findUnique({ where: { id: "payment-review" } }))?.status).toBe("UNDER_REVIEW");
    expect((await prisma.paymentReceipt.findUnique({ where: { id: "receipt-review" } }))?.status).toBe("PROCESSED");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-review" } }))?.rechargeStatus).toBe("UNDER_REVIEW");
  });

  async function evaluate(suffix: string, code: string) {
    const context = (await repository.loadReceiptContext(`receipt-${suffix}`))!;
    return repository.saveOcrEvaluation({
      context, ocrResultId: `ocr-${suffix}`, verificationId: `verification-${suffix}`,
      extracted: extracted(code),
      evaluation: { status: VerificationStatus.UNDER_REVIEW, amountMatches: true, issues: [], requiresManualReview: true },
    });
  }

  async function createPending(suffix: string, checksum: string) {
    await prisma.rechargeTransaction.create({
      data: {
        id: `transaction-${suffix}`, code: `TX-${suffix}`, idempotencyKey: `idem-${suffix}`,
        clientId: "p3-client", accountId: "p3-account", accountTypeSnapshot: "PREPAGO",
        rechargeStatus: "UNDER_REVIEW", pautaAmount: 100, isdAmount: 5, agencyFeeAmount: 10,
        vatBaseAmount: 115, vatAmount: 17.25, totalAmount: 132.25,
        details: { create: { id: `detail-${suffix}`, pautaId: "p3-pauta", platformSnapshot: "META", requestedAmount: 100, isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25, totalAmount: 132.25 } },
        payment: { create: { id: `payment-${suffix}`, status: "UNDER_REVIEW", expectedAmount: 132.25, receipts: { create: { id: `receipt-${suffix}`, originalName: "receipt.png", mimeType: "image/png", size: 10, url: "/receipt.png", checksum } } } },
      },
    });
  }

  function extracted(code: string) {
    return { bank: "Banco", detectedAmount: 132.25, detectedDate: new Date(), transactionCode: code, originator: "Cliente", confidence: 95, rawText: "receipt" };
  }
});
