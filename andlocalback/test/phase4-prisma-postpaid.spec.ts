import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import { PrismaService } from "../src/database/prisma.service";
import { Payment } from "../src/modules/recharges/domain/entities/payment";
import { Transaction } from "../src/modules/recharges/domain/entities/transaction";
import { PautaStatus, TransactionPaymentStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { PrismaPostpaidTransactionRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-postpaid-transaction.repository";
import { PrismaTransactionVerificationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-transaction-verification.repository";

describe("persistencia POSTPAGO fase 4", () => {
  let directory: string;
  let prisma: PrismaClient;
  let postpaid: PrismaPostpaidTransactionRepository;
  let verification: PrismaTransactionVerificationRepository;

  const clientId = "phase4-client";
  const accountId = "phase4-account";

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-phase4-"));
    const databasePath = join(directory, "phase4.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    postpaid = new PrismaPostpaidTransactionRepository(prisma as PrismaService);
    verification = new PrismaTransactionVerificationRepository(prisma as PrismaService);
    await prisma.client.create({
      data: { id: clientId, name: "Cliente Phase 4", email: "phase4@example.test", status: "ACTIVE" },
    });
    await prisma.account.create({
      data: { id: accountId, clientId, status: "ACTIVE", type: AccountType.POSTPAID, creditDays: 30, creditLimit: 1500, creditUsed: 0 },
    });
    await prisma.pauta.createMany({ data: [
      { id: "phase4-meta", clientId, platform: AdvertisingPlatform.META, status: PautaStatus.ACTIVE },
      { id: "phase4-google", clientId, platform: AdvertisingPlatform.GOOGLE, status: PautaStatus.ACTIVE },
    ] });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("reserva el total facturable y persiste una sola transaccion con N detalles", async () => {
    const result = await postpaid.savePostpaid(createPostpaidRecord("first", "idem-first", 500, 300));

    expect(result.status).toBe(TransactionRechargeStatus.APPROVED);
    expect(result.details).toHaveLength(2);
    expect(result.payment).toMatchObject({ status: TransactionPaymentStatus.IN_CREDIT, expectedAmount: 1058 });
    expect(result.payment.dueDate).toBe("2026-10-10T12:00:00.000Z");
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("1058.00");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: result.id } }))?.creditDaysSnapshot).toBe(30);
  });

  it("un retry idempotente no vuelve a reservar credito", async () => {
    const winner = await postpaid.savePostpaid(createPostpaidRecord("retry", "idem-first", 500, 300));

    expect(winner.id).toBe("transaction-first");
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("1058.00");
    expect(await prisma.rechargeTransaction.count({ where: { clientId } })).toBe(1);
  });

  it("rechaza atomicamente cuando el credito vivo ya no alcanza sin crear datos parciales", async () => {
    await expect(postpaid.savePostpaid(createPostpaidRecord("insufficient", "idem-insufficient", 500)))
      .rejects.toMatchObject({ code: "CREDIT_INSUFFICIENT" });

    expect(await prisma.rechargeTransaction.count({ where: { id: "transaction-insufficient" } })).toBe(0);
    expect(await prisma.payment.count({ where: { id: "payment-insufficient" } })).toBe(0);
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("1058.00");
  });

  it("marca vencimientos sobre Payment sin modificar el estado operativo", async () => {
    await prisma.payment.update({
      where: { id: "payment-first" },
      data: { dueDate: new Date("2026-09-01T00:00:00.000Z") },
    });
    await prisma.rechargeTransaction.update({
      where: { id: "transaction-first" }, data: { rechargeStatus: "COMPLETED" },
    });
    await prisma.transactionDetail.updateMany({
      where: { transactionId: "transaction-first" }, data: { status: "COMPLETED" },
    });

    expect(await postpaid.markOverduePayments(new Date("2026-09-10T00:00:00.000Z"))).toBe(1);
    expect((await prisma.payment.findUnique({ where: { id: "payment-first" } }))?.status).toBe("OVERDUE");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-first" } }))?.rechargeStatus).toBe("COMPLETED");
  });

  it("aprobar el comprobante POSTPAGO libera credito una vez sin regresar la recarga", async () => {
    await addReceiptAndVerification("first", "approve", "PROCESSED", new Date("2026-09-01T00:00:00.000Z"));
    const context = (await verification.loadVerificationContext("verification-approve"))!;
    await verification.approveAtomically({ context, administratorId: "admin", notes: null, decidedAt: new Date("2026-09-10T00:00:00.000Z") });

    expect((await prisma.payment.findUnique({ where: { id: "payment-first" } }))?.status).toBe("PAID");
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("0.00");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-first" } }))?.rechargeStatus).toBe("COMPLETED");
    expect((await prisma.transactionDetail.findFirst({ where: { transactionId: "transaction-first" } }))?.status).toBe("COMPLETED");
    await expect(verification.approveAtomically({ context, administratorId: "admin", notes: null, decidedAt: new Date() }))
      .rejects.toMatchObject({ code: "VERIFICATION_ALREADY_RESOLVED" });
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("0.00");
  });

  it("rechazar evidencia POSTPAGO conserva la obligacion y el estado operativo", async () => {
    const record = createPostpaidRecord("reject", "idem-reject", 100);
    await postpaid.savePostpaid(record);
    await prisma.rechargeTransaction.update({ where: { id: "transaction-reject" }, data: { rechargeStatus: "PROCESSING" } });
    await prisma.transactionDetail.updateMany({ where: { transactionId: "transaction-reject" }, data: { status: "PROCESSING" } });
    await addReceiptAndVerification("reject", "reject", "PROCESSED", new Date("2026-10-10T00:00:00.000Z"));
    const context = (await verification.loadVerificationContext("verification-reject"))!;

    await verification.rejectAtomically({ context, administratorId: "admin", reason: "invalido", decidedAt: new Date("2026-09-10T00:00:00.000Z") });

    expect((await prisma.payment.findUnique({ where: { id: "payment-reject" } }))?.status).toBe("IN_CREDIT");
    expect((await prisma.rechargeTransaction.findUnique({ where: { id: "transaction-reject" } }))?.rechargeStatus).toBe("PROCESSING");
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("132.25");
  });

  it("dos reservas concurrentes comparan el credito vivo y solo una puede consumirlo", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { creditLimit: 900, creditUsed: 0 } });
    const results = await Promise.allSettled([
      postpaid.savePostpaid(createPostpaidRecord("race-a", "idem-race-a", 500)),
      postpaid.savePostpaid(createPostpaidRecord("race-b", "idem-race-b", 500)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    expect(rejected.reason).toBeInstanceOf(ApplicationError);
    expect(rejected.reason.code).toBe("CREDIT_INSUFFICIENT");
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("661.25");
    expect(await prisma.rechargeTransaction.count({ where: { id: { in: ["transaction-race-a", "transaction-race-b"] } } })).toBe(1);
  });

  it("dos solicitudes concurrentes con la misma clave observan un solo ganador y una sola reserva", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { creditLimit: 900, creditUsed: 0 } });
    const [first, second] = await Promise.all([
      postpaid.savePostpaid(createPostpaidRecord("same-key-a", "idem-same-key", 500)),
      postpaid.savePostpaid(createPostpaidRecord("same-key-b", "idem-same-key", 500)),
    ]);

    expect(second.id).toBe(first.id);
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("661.25");
    expect(await prisma.rechargeTransaction.count({ where: { idempotencyKey: "idem-same-key" } })).toBe(1);
  });

  it("el limite de credito se compara en centavos exactos, sin margen de punto flotante", async () => {
    // 100.00 de pauta factura exactamente 132.25 (ISD 5% + comision 10%, IVA 15%).
    // Con el limite fijado en ese mismo valor, la reserva cae justo en el borde:
    // debe aceptarse, porque el credito disponible es exactamente el requerido.
    await prisma.account.update({ where: { id: accountId }, data: { creditLimit: 132.25, creditUsed: 0 } });

    await postpaid.savePostpaid(createPostpaidRecord("edge-exact", "idem-edge-exact", 100));

    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("132.25");

    // Y un centavo por encima del limite debe rechazarse.
    await prisma.account.update({ where: { id: accountId }, data: { creditUsed: 0 } });
    await expect(
      postpaid.savePostpaid(createPostpaidRecord("edge-over", "idem-edge-over", 100.01)),
    ).rejects.toMatchObject({ code: "CREDIT_INSUFFICIENT" });
    expect((await prisma.account.findUnique({ where: { id: accountId } }))?.creditUsed?.toFixed(2)).toBe("0.00");
  });

  function createPostpaidRecord(suffix: string, idempotencyKey: string, meta: number, google?: number) {
    const createdAt = new Date("2026-09-10T12:00:00.000Z");
    const details = [{
      id: `detail-meta-${suffix}`,
      pauta: { pautaId: "phase4-meta", platform: AdvertisingPlatform.META, externalAccountId: null },
      requestedAmount: MonetaryAmount.fromMajorUnits(meta),
    }];
    if (google !== undefined) details.push({
      id: `detail-google-${suffix}`,
      pauta: { pautaId: "phase4-google", platform: AdvertisingPlatform.GOOGLE, externalAccountId: null },
      requestedAmount: MonetaryAmount.fromMajorUnits(google),
    });
    const transaction = Transaction.create({
      id: `transaction-${suffix}`, code: `TX-${suffix}`, idempotencyKey, clientId, accountId,
      accountTypeSnapshot: AccountType.POSTPAID, createdAt, details,
    });
    transaction.authorize();
    const payment = Payment.create({
      id: `payment-${suffix}`, transactionId: transaction.id, accountTypeSnapshot: AccountType.POSTPAID,
      expectedAmount: transaction.totals.totalAmount, createdAt, dueDate: new Date("2026-10-10T12:00:00.000Z"),
    });
    return { transaction, payment };
  }

  async function addReceiptAndVerification(transactionSuffix: string, suffix: string, receiptStatus: string, dueDate: Date) {
    const paymentId = `payment-${transactionSuffix}`;
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "UNDER_REVIEW", dueDate } });
    await prisma.paymentReceipt.create({ data: {
      id: `receipt-${suffix}`, paymentId, originalName: "receipt.png", mimeType: "image/png", size: 10,
      url: `/receipt-${suffix}.png`, checksum: `hash-${suffix}`, status: receiptStatus,
    } });
    await prisma.transactionVerification.create({ data: {
      id: `verification-${suffix}`, transactionId: `transaction-${transactionSuffix}`, paymentId,
      receiptId: `receipt-${suffix}`, status: VerificationStatus.UNDER_REVIEW,
      expectedAmount: (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).expectedAmount,
      issues: "[]", requiresManualReview: true,
    } });
  }
});
