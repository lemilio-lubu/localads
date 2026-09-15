import { describe, expect, it } from "vitest";
import { ApprovePrepaidVerification } from "../src/modules/recharges/application/use-cases/approve-prepaid-verification";
import { CreatePostpaidRecharge } from "../src/modules/recharges/application/use-cases/create-postpaid-recharge";
import { CreatePrepaidRecharge } from "../src/modules/recharges/application/use-cases/create-prepaid-recharge";
import { MoveRechargeToProcessing } from "../src/modules/recharges/application/use-cases/move-recharge-to-processing";
import { RejectPrepaidVerification } from "../src/modules/recharges/application/use-cases/reject-prepaid-verification";
import { ReplacePrepaidReceipt } from "../src/modules/recharges/application/use-cases/replace-prepaid-receipt";
import { Account } from "../src/modules/recharges/domain/entities/account";
import {
  AccountStatus, AccountType, AdvertisingPlatform, CampaignStatus, ClientStatus, PaymentStatus,
  ReceiptStatus, RechargeStatus, StoredReceipt, VerificationIssue, VerificationStatus,
} from "../src/modules/recharges/domain/recharge.types";
import { InMemoryAccountRepository } from "../src/modules/recharges/infrastructure/persistence/in-memory-account.repository";
import { InMemoryRechargeRepository } from "../src/modules/recharges/infrastructure/persistence/in-memory-recharge.repository";
import { extractAmountsFromText } from "../src/modules/recharges/infrastructure/services/receipt-amount-extractor";
import { TesseractOcrProcessor } from "../src/modules/recharges/infrastructure/services/tesseract-ocr-processor";
import type { TransactionRealtimeEvent } from "../src/modules/recharges/application/ports/recharge.ports";

const validReceipt: StoredReceipt = {
  id: "receipt-001", originalName: "comprobante.png", mimeType: "image/png", size: 128,
  url: "/uploads/receipts/comprobante.png", checksum: "a".repeat(64),
};
const upload = { originalName: "comprobante.png", mimeType: "image/png", size: 128, buffer: Buffer.from("receipt") };

function prepaidFixture(ocr: { confidence: number; detectedAmounts: number[] } | Error) {
  const recharges = new InMemoryRechargeRepository();
  const create = new CreatePrepaidRecharge(
    new InMemoryAccountRepository(), recharges,
    { process: async () => validReceipt },
    { process: async () => { if (ocr instanceof Error) throw ocr; return { text: "OCR", ...ocr }; } },
    { generate: () => "recharge-001" },
  );
  return { create, recharges };
}

describe("OCR de recargas prepago", () => {
  it("crea una verificación EN_REVISION y bloquea la ejecución aunque el monto coincida", async () => {
    const { create, recharges } = prepaidFixture({ confidence: 96, detectedAmounts: [800] });
    const result = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 800, receipt: upload });

    expect(result.paymentStatus).toBe(PaymentStatus.UNDER_REVIEW);
    expect(result.status).toBe(RechargeStatus.PENDING_VERIFICATION);
    expect(result.receiptStatus).toBe(ReceiptStatus.PROCESSED);
    expect(result.verification).toMatchObject({
      status: VerificationStatus.UNDER_REVIEW,
      detectedAmount: 800,
      amountMatches: true,
      issues: [],
      requiresManualReview: true,
    });
    expect(result.canTransitionToProcessing).toBe(false);
    await expect(new MoveRechargeToProcessing(recharges).execute(result.id))
      .rejects.toMatchObject({ code: "INVALID_RECHARGE_TRANSITION" });
  });

  it("registra inconsistencia cuando OCR detecta $750 para una recarga de $800", async () => {
    const { create } = prepaidFixture({ confidence: 94, detectedAmounts: [750] });
    const result = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 800, receipt: upload });

    expect(result.paymentStatus).not.toBe(PaymentStatus.PAID);
    expect(result.verification).toMatchObject({
      detectedAmount: 750,
      amountMatches: false,
      status: VerificationStatus.UNDER_REVIEW,
      issues: [VerificationIssue.AMOUNT_MISMATCH],
    });
  });

  it("mantiene revisión manual y el original disponible con confianza menor a 80", async () => {
    const { create } = prepaidFixture({ confidence: 62, detectedAmounts: [800] });
    const result = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 800, receipt: upload });

    expect(result.receipt).toEqual(validReceipt);
    expect(result.verification?.issues).toContain(VerificationIssue.LOW_CONFIDENCE);
    expect(result.verification?.requiresManualReview).toBe(true);
    expect(result.paymentStatus).toBe(PaymentStatus.UNDER_REVIEW);
  });

  it("marca el comprobante FALLIDO y conserva el original cuando OCR falla técnicamente", async () => {
    const { create } = prepaidFixture(new Error("worker unavailable"));
    const result = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 800, receipt: upload });

    expect(result.receipt).toEqual(validReceipt);
    expect(result.receiptStatus).toBe(ReceiptStatus.FAILED);
    expect(result.paymentStatus).not.toBe(PaymentStatus.PAID);
    expect(result.verification).toMatchObject({
      status: VerificationStatus.UNDER_REVIEW,
      issues: [VerificationIssue.OCR_FAILURE],
      requiresManualReview: true,
      failureReason: "worker unavailable",
    });
  });

  it("sólo permite EN_PROCESO después de la aprobación manual", async () => {
    const { create, recharges } = prepaidFixture({ confidence: 99, detectedAmounts: [500] });
    const events: TransactionRealtimeEvent[] = [];
    const pending = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 500, receipt: upload });
    const approved = await new ApprovePrepaidVerification(recharges, { publish: (event) => events.push(event) }).execute(pending.id, "admin-001");
    const processing = await new MoveRechargeToProcessing(recharges).execute(pending.id);

    expect(approved.paymentStatus).toBe(PaymentStatus.PAID);
    expect(approved.status).toBe(RechargeStatus.APPROVED);
    expect(approved.verification?.status).toBe(VerificationStatus.APPROVED);
    expect(approved.verification?.decidedBy).toBe("admin-001");
    expect(approved.verification?.decidedAt).not.toBeNull();
    expect(events).toMatchObject([{ change: "UPDATED", transaction: { verification: { status: VerificationStatus.APPROVED } } }]);
    expect(processing.status).toBe(RechargeStatus.IN_PROCESS);
  });

  it("rechaza la verificación, conserva el comprobante y bloquea la recarga", async () => {
    const { create, recharges } = prepaidFixture({ confidence: 99, detectedAmounts: [500] });
    const pending = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 500, receipt: upload });
    const rejected = await new RejectPrepaidVerification(recharges).execute(pending.id, "admin-002", "Comprobante alterado");

    expect(rejected.verification).toMatchObject({ status: VerificationStatus.REJECTED, decidedBy: "admin-002", rejectionReason: "Comprobante alterado" });
    expect(rejected.receipts).toHaveLength(1);
    expect(rejected.paymentStatus).toBe(PaymentStatus.REJECTED);
    expect(rejected.canTransitionToProcessing).toBe(false);
    await expect(new MoveRechargeToProcessing(recharges).execute(pending.id)).rejects.toMatchObject({ code: "INVALID_RECHARGE_TRANSITION" });
  });

  it("crea un nuevo comprobante y verificación después de rechazo sin borrar los anteriores", async () => {
    const { create, recharges } = prepaidFixture({ confidence: 99, detectedAmounts: [500] });
    const pending = await create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 500, receipt: upload });
    await new RejectPrepaidVerification(recharges).execute(pending.id, "admin-002", "No válido");
    const replacement = { ...validReceipt, id: "receipt-002", originalName: "nuevo.png" };
    const result = await new ReplacePrepaidReceipt(
      recharges,
      { process: async () => replacement },
      { process: async () => ({ text: "TOTAL 500", confidence: 98, detectedAmounts: [500] }) },
    ).execute(pending.id, { ...upload, originalName: "nuevo.png" });

    expect(result.receipts.map((receipt) => receipt.id)).toEqual(["receipt-001", "receipt-002"]);
    expect(result.verifications).toHaveLength(2);
    expect(result.verifications[0].status).toBe(VerificationStatus.REJECTED);
    expect(result.verification?.status).toBe(VerificationStatus.UNDER_REVIEW);
  });

  it("rechaza PREPAGO sin comprobante y no crea una transacción", async () => {
    const { create, recharges } = prepaidFixture({ confidence: 99, detectedAmounts: [500] });
    await expect(create.execute({ accountId: "account-prepaid-001", platform: AdvertisingPlatform.META, amount: 500 }))
      .rejects.toMatchObject({ code: "RECEIPT_REQUIRED" });
    await expect(recharges.findById("recharge-001")).resolves.toBeNull();
  });

  it("extrae montos habituales de comprobantes colombianos", () => {
    expect(extractAmountsFromText("TOTAL: $ 800.00")).toContain(800);
    expect(extractAmountsFromText("VALOR COP 1.250.000")).toContain(1_250_000);
  });

  it("envía un PDF al fallback técnico conservable, sin intentar reconocerlo como imagen", async () => {
    const processor = new TesseractOcrProcessor();
    await expect(processor.process({ originalName: "transferencia.pdf", mimeType: "application/pdf", size: 16, buffer: Buffer.from("%PDF") }))
      .rejects.toThrow("no procesa PDF directamente");
  });
});

describe("Reglas de cuenta y flujo postpago", () => {
  it("BR-007 impide crear una cuenta sin un único tipo válido", () => {
    expect(() => new Account("invalid", { id: "client", status: ClientStatus.ACTIVE }, AccountStatus.ACTIVE, "AMBAS" as AccountType, []))
      .toThrowError(expect.objectContaining({ code: "INVALID_ACCOUNT_TYPE" }));
  });

  it("BR-006 rechaza recargas cuando la cuenta no está activa", async () => {
    const account = new Account("inactive", { id: "client", status: ClientStatus.ACTIVE }, AccountStatus.INACTIVE, AccountType.POSTPAID,
      [{ id: "campaign", platform: AdvertisingPlatform.META, status: CampaignStatus.ACTIVE }]);
    const useCase = new CreatePostpaidRecharge({ findById: async () => account }, new InMemoryRechargeRepository(), { generate: () => "id" });
    await expect(useCase.execute({ accountId: account.id, platform: AdvertisingPlatform.META, amount: 500 }))
      .rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  });

  it("crea POSTPAGO sin comprobante, consume cupo y genera obligación EN_CREDITO", async () => {
    const recharges = new InMemoryRechargeRepository();
    const accounts = new InMemoryAccountRepository();
    const account = await accounts.findById("account-postpaid-001");
    const events: TransactionRealtimeEvent[] = [];
    const useCase = new CreatePostpaidRecharge(accounts, recharges, { generate: () => "postpaid" }, { publish: (event) => events.push(event) });
    const result = await useCase.execute({ accountId: "account-postpaid-001", platform: AdvertisingPlatform.META, amount: 500 });
    expect(result).toMatchObject({ accountType: AccountType.POSTPAID, receipt: null, paymentStatus: PaymentStatus.ON_CREDIT, status: RechargeStatus.APPROVED });
    expect(result.obligation).toMatchObject({ amount: 500, status: PaymentStatus.ON_CREDIT });
    expect(new Date(result.obligation!.dueDate).getTime()).toBeGreaterThan(new Date(result.createdAt).getTime());
    expect(account?.creditUsed).toBe(500);
    expect(events).toMatchObject([{ change: "CREATED", transaction: { id: "postpaid", paymentStatus: PaymentStatus.ON_CREDIT } }]);
    await expect(new MoveRechargeToProcessing(recharges).execute(result.id)).resolves.toMatchObject({ status: RechargeStatus.IN_PROCESS });
  });

  it("rechaza POSTPAGO que supera el cupo sin consumir crédito", async () => {
    const account = new Account("limited", { id: "client", status: ClientStatus.ACTIVE }, AccountStatus.ACTIVE, AccountType.POSTPAID,
      [{ id: "campaign", platform: AdvertisingPlatform.META, status: CampaignStatus.ACTIVE }], 15, 300);
    const useCase = new CreatePostpaidRecharge({ findById: async () => account }, new InMemoryRechargeRepository(), { generate: () => "rejected" });

    await expect(useCase.execute({ accountId: account.id, platform: AdvertisingPlatform.META, amount: 500 }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT" });
    expect(account.creditUsed).toBe(0);
  });
});
