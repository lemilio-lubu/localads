import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { PrismaTransactionExecutionRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-transaction-execution.repository";

describe("persistencia de ejecucion de recarga fase 5", () => {
  let directory: string;
  let prisma: PrismaClient;
  let repository: PrismaTransactionExecutionRepository;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-phase5-"));
    const databasePath = join(directory, "phase5.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    repository = new PrismaTransactionExecutionRepository(prisma as PrismaService);
    await prisma.client.create({
      data: { id: "p5-client", name: "Cliente Phase 5", email: "phase5@example.test", status: "ACTIVE" },
    });
    await prisma.account.create({
      data: { id: "p5-account", clientId: "p5-client", type: "POSTPAGO", status: "ACTIVE", creditDays: 30, creditLimit: 10000 },
    });
    await prisma.pauta.createMany({ data: [
      { id: "p5-meta", clientId: "p5-client", platform: "META", status: "ACTIVE", currentBalance: 100 },
      { id: "p5-google", clientId: "p5-client", platform: "GOOGLE", status: "ACTIVE", currentBalance: 20 },
      { id: "p5-tiktok", clientId: "p5-client", platform: "TIKTOK", status: "ACTIVE", currentBalance: 10 },
    ] });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("inicia la transaccion y todos sus detalles mediante CAS", async () => {
    await createApprovedTransaction("start", ["p5-meta", "p5-google"]);
    const context = (await repository.loadExecutionContext("p5-tx-start"))!;
    const result = await repository.startTransaction(context.id, context.version, at("12:00"));

    expect(result.status).toBe(TransactionRechargeStatus.PROCESSING);
    expect(result.details.every((detail) => detail.status === TransactionDetailStatus.PROCESSING)).toBe(true);
    await expect(repository.startTransaction(context.id, context.version, at("12:01")))
      .rejects.toMatchObject({ code: "TRANSACTION_NOT_APPROVED" });
  });

  it("contabiliza una recarga efectiva exactamente una vez aunque la pauta se suspenda", async () => {
    await createApprovedTransaction("detail", ["p5-meta"]);
    const context = (await repository.loadExecutionContext("p5-tx-detail"))!;
    await repository.startTransaction(context.id, context.version, at("12:00"));
    await prisma.pauta.update({ where: { id: "p5-meta" }, data: { status: "SUSPENDED" } });
    const command = {
      transactionId: context.id,
      detailId: "p5-detail-detail-0",
      effectiveAmount: MonetaryAmount.fromMajorUnits(95),
      executedBy: "admin-test",
      effectiveRechargeDate: at("12:05"),
      completedAt: at("12:06"),
    };

    const first = await repository.completeTransactionDetail(command);
    const retry = await repository.completeTransactionDetail({ ...command, completedAt: at("13:00") });

    expect(retry).toEqual(first);
    expect(first.pautaBalance).toBe(195);
    expect(await prisma.pautaBalanceMovement.count({ where: { transactionDetailId: command.detailId } })).toBe(1);
    expect((await prisma.pauta.findUniqueOrThrow({ where: { id: "p5-meta" } })).currentBalance.toFixed(2)).toBe("195.00");
    await expect(repository.completeTransactionDetail({ ...command, effectiveAmount: MonetaryAmount.fromMajorUnits(96) }))
      .rejects.toMatchObject({ code: "DETAIL_ALREADY_COMPLETED" });
  });

  it("completa y factura atomicamente desde snapshots sin modificar el pago postpago", async () => {
    await createApprovedTransaction("final", ["p5-google"]);
    const context = (await repository.loadExecutionContext("p5-tx-final"))!;
    await repository.startTransaction(context.id, context.version, at("12:00"));
    await repository.completeTransactionDetail({
      transactionId: context.id,
      detailId: "p5-detail-final-0",
      effectiveAmount: MonetaryAmount.fromMajorUnits(100),
      executedBy: "admin-test",
      effectiveRechargeDate: at("12:05"),
      completedAt: at("12:06"),
    });
    const processing = (await repository.loadExecutionContext(context.id))!;
    const result = await repository.finalizeTransactionAndIssueInvoice({
      transactionId: context.id,
      expectedVersion: processing.version,
      invoiceId: "p5-invoice-final",
      completedAt: at("12:10"),
    });

    expect(result.transaction.status).toBe(TransactionRechargeStatus.COMPLETED);
    expect(result.invoice).toMatchObject({
      number: "FAC-P5-TX-final",
      pautaAmount: 100,
      isdAmount: 5,
      agencyCommissionAmount: 10,
      vatBaseAmount: 115,
      vatAmount: 17.25,
      totalAmount: 132.25,
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { transactionId: context.id } })).status).toBe("IN_CREDIT");
  });

  it("dos completados concurrentes acreditan un solo movimiento y un solo incremento", async () => {
    await createApprovedTransaction("detail-race", ["p5-tiktok"]);
    const context = (await repository.loadExecutionContext("p5-tx-detail-race"))!;
    await repository.startTransaction(context.id, context.version, at("12:00"));
    const command = {
      transactionId: context.id,
      detailId: "p5-detail-detail-race-0",
      effectiveAmount: MonetaryAmount.fromMajorUnits(40),
      executedBy: "admin-test",
      effectiveRechargeDate: at("12:05"),
      completedAt: at("12:06"),
    };

    const [first, second] = await Promise.all([
      repository.completeTransactionDetail(command),
      repository.completeTransactionDetail(command),
    ]);

    expect(second).toEqual(first);
    expect(await prisma.pautaBalanceMovement.count({ where: { transactionDetailId: command.detailId } })).toBe(1);
    expect((await prisma.pauta.findUniqueOrThrow({ where: { id: "p5-tiktok" } })).currentBalance.toFixed(2)).toBe("50.00");
  });

  it("dos finalizaciones observan una sola factura", async () => {
    await createApprovedTransaction("race", ["p5-google"]);
    const initial = (await repository.loadExecutionContext("p5-tx-race"))!;
    await repository.startTransaction(initial.id, initial.version, at("12:00"));
    await repository.completeTransactionDetail({
      transactionId: initial.id,
      detailId: "p5-detail-race-0",
      effectiveAmount: MonetaryAmount.fromMajorUnits(100),
      executedBy: "admin-test",
      effectiveRechargeDate: at("12:05"),
      completedAt: at("12:06"),
    });
    const processing = (await repository.loadExecutionContext(initial.id))!;
    const command = { transactionId: initial.id, expectedVersion: processing.version, invoiceId: "p5-invoice-race", completedAt: at("12:10") };

    const [first, second] = await Promise.all([
      repository.finalizeTransactionAndIssueInvoice(command),
      repository.finalizeTransactionAndIssueInvoice(command),
    ]);

    expect(second.invoice.id).toBe(first.invoice.id);
    expect(await prisma.invoice.count({ where: { transactionId: initial.id } })).toBe(1);
  });

  async function createApprovedTransaction(suffix: string, pautaIds: string[]) {
    await prisma.rechargeTransaction.create({
      data: {
        id: `p5-tx-${suffix}`,
        code: `P5-TX-${suffix}`,
        idempotencyKey: `p5-idem-${suffix}`,
        clientId: "p5-client",
        accountId: "p5-account",
        accountTypeSnapshot: "POSTPAGO",
        rechargeStatus: "APPROVED",
        pautaAmount: 100,
        isdAmount: 5,
        agencyFeeAmount: 10,
        vatBaseAmount: 115,
        vatAmount: 17.25,
        totalAmount: 132.25,
        details: { create: pautaIds.map((pautaId, index) => ({
          id: `p5-detail-${suffix}-${index}`,
          pautaId,
          platformSnapshot: pautaId === "p5-meta" ? "META" : pautaId === "p5-google" ? "GOOGLE" : "TIKTOK",
          requestedAmount: 100,
          isdAmount: 5,
          agencyFeeAmount: 10,
          vatBaseAmount: 115,
          vatAmount: 17.25,
          totalAmount: 132.25,
          status: "APPROVED",
        })) },
        payment: { create: { id: `p5-payment-${suffix}`, status: "IN_CREDIT", expectedAmount: 132.25, dueDate: at("23:59") } },
      },
    });
  }
});

function at(time: string): Date {
  return new Date(`2026-09-10T${time}:00.000Z`);
}
