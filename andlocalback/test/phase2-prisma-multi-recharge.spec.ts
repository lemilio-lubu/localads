import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { Payment } from "../src/modules/recharges/domain/entities/payment";
import { Transaction } from "../src/modules/recharges/domain/entities/transaction";
import { PautaStatus, TransactionPaymentStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { PrismaMultiRechargeRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-multi-recharge.repository";

describe("PrismaMultiRechargeRepository", () => {
  let temporaryDirectory: string;
  let prisma: PrismaClient;
  let repository: PrismaMultiRechargeRepository;

  const clientId = "phase2-client";
  const accountId = "phase2-account";

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "andlocal-phase2-"));
    const databasePath = join(temporaryDirectory, "phase2.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    repository = new PrismaMultiRechargeRepository(prisma as PrismaService);

    await prisma.client.create({
      data: { id: clientId, name: "Cliente Phase 2", email: "phase2@example.test", status: "ACTIVE" },
    });
    await prisma.account.create({
      data: { id: accountId, clientId, status: "ACTIVE", type: AccountType.PREPAID },
    });
    await prisma.pauta.createMany({
      data: [
        { id: "phase2-meta", clientId, platform: AdvertisingPlatform.META, status: PautaStatus.ACTIVE, currentBalance: "10.25" },
        { id: "phase2-google", clientId, platform: AdvertisingPlatform.GOOGLE, status: PautaStatus.ACTIVE, currentBalance: "20.50" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("carga cliente, cuenta y pautas desde el nuevo modelo", async () => {
    const context = await repository.loadContext(accountId);

    expect(context.client).toEqual({ id: clientId, status: "ACTIVE" });
    expect(context.account).toEqual({ id: accountId, clientId, status: "ACTIVE", type: AccountType.PREPAID });
    expect(Object.fromEntries(
      context.pautas.map((pauta) => [pauta.props.platform, pauta.currentBalance.toMajorUnits()]),
    )).toEqual({ META: "10.25", GOOGLE: "20.50" });
  });

  it("guarda atomicamente una transaccion, N detalles, un pago y un comprobante", async () => {
    const record = createRecord("first", "phase2-idempotency");
    const result = await repository.savePrepaid(record);

    expect(result.details).toHaveLength(2);
    expect(result.totals).toEqual({
      pautaAmount: 800,
      isdAmount: 40,
      agencyCommissionAmount: 80,
      vatBaseAmount: 920,
      vatAmount: 138,
      totalAmount: 1058,
    });
    expect(result.payment.status).toBe(TransactionPaymentStatus.UNDER_REVIEW);
    expect(result.payment.expectedAmount).toBe(1058);
    expect(result.receipt.checksum).toBe("checksum-first");

    expect(await prisma.rechargeTransaction.count({ where: { clientId } })).toBe(1);
    expect(await prisma.transactionDetail.count({ where: { transaction: { clientId } } })).toBe(2);
    expect(await prisma.payment.count({ where: { transaction: { clientId } } })).toBe(1);
    expect(await prisma.paymentReceipt.count({ where: { payment: { transaction: { clientId } } } })).toBe(1);
  });

  it("ante P2002 por idempotencia devuelve el ganador sin duplicar datos", async () => {
    const competingRecord = createRecord("competitor", "phase2-idempotency");
    const winner = await repository.savePrepaid(competingRecord);

    expect(winner.id).toBe("transaction-first");
    expect(winner.idempotencyKey).toBe("phase2-idempotency");
    expect(await prisma.rechargeTransaction.count({ where: { clientId } })).toBe(1);
    expect(await prisma.transactionDetail.count({ where: { transaction: { clientId } } })).toBe(2);
    expect(await prisma.payment.count({ where: { transaction: { clientId } } })).toBe(1);
    expect(await prisma.paymentReceipt.count({ where: { payment: { transaction: { clientId } } } })).toBe(1);
  });

  function createRecord(suffix: string, idempotencyKey: string) {
    const transaction = Transaction.create({
      id: `transaction-${suffix}`,
      code: `TX-${suffix}`,
      idempotencyKey,
      clientId,
      accountId,
      accountTypeSnapshot: AccountType.PREPAID,
      createdAt: new Date("2026-09-09T12:00:00.000Z"),
      details: [
        {
          id: `detail-meta-${suffix}`,
          pauta: { pautaId: "phase2-meta", platform: AdvertisingPlatform.META, externalAccountId: null },
          requestedAmount: MonetaryAmount.fromMajorUnits("500.00"),
        },
        {
          id: `detail-google-${suffix}`,
          pauta: { pautaId: "phase2-google", platform: AdvertisingPlatform.GOOGLE, externalAccountId: null },
          requestedAmount: MonetaryAmount.fromMajorUnits("300.00"),
        },
      ],
    });
    transaction.markUnderReview();

    const payment = Payment.create({
      id: `payment-${suffix}`,
      transactionId: transaction.id,
      accountTypeSnapshot: AccountType.PREPAID,
      expectedAmount: transaction.totals.totalAmount,
      createdAt: new Date("2026-09-09T12:00:00.000Z"),
    });
    payment.sendToReview();

    return {
      transaction,
      payment,
      receipt: {
        id: `receipt-${suffix}`,
        originalName: "transferencia.png",
        mimeType: "image/png",
        size: 1024,
        url: `/uploads/receipt-${suffix}.png`,
        checksum: `checksum-${suffix}`,
        createdAt: "2026-09-09T12:00:00.000Z",
      },
    };
  }
});
