import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { PrismaPhase7QueryRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-phase7-query.repository";
import { createTestDatabase } from "./support/postgres-test-database";

/* «En camino» es lo aprobado que todavía no llegó a la plataforma: el cliente
   postpago lo ve aprobado y el saldo sigue en cero hasta que el equipo lo
   acredita. Lo ya acreditado ya está en currentBalance y no se suma dos veces. */
describe("saldo en camino por pauta", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;
  let repository: PrismaPhase7QueryRepository;
  const clientId = "camino-client";

  beforeAll(async () => {
    testDatabase = await createTestDatabase("saldo_en_camino");
    prisma = new PrismaClient({ datasourceUrl: testDatabase.url });
    repository = new PrismaPhase7QueryRepository(prisma as PrismaService);

    await prisma.client.create({ data: { id: clientId, name: "Cliente Camino", email: "camino@example.test", status: "ACTIVE" } });
    await prisma.account.create({ data: { id: "camino-account", clientId, status: "ACTIVE", type: AccountType.POSTPAID, creditDays: 30 } });
    await prisma.pauta.createMany({ data: [
      { id: "camino-meta", clientId, platform: AdvertisingPlatform.META, status: "ACTIVE", currentBalance: new Prisma.Decimal("30") },
      { id: "camino-google", clientId, platform: AdvertisingPlatform.GOOGLE, status: "ACTIVE", currentBalance: new Prisma.Decimal("0") },
    ] });

    await line("aprobada", TransactionRechargeStatus.APPROVED, TransactionDetailStatus.APPROVED, "100");
    await line("en-proceso", TransactionRechargeStatus.PROCESSING, TransactionDetailStatus.PROCESSING, "40.50");
    await line("ya-acreditada", TransactionRechargeStatus.PROCESSING, TransactionDetailStatus.COMPLETED, "30");
    await line("pausada", TransactionRechargeStatus.PROCESSING, TransactionDetailStatus.PROCESSING, "20", new Date());
    await line("pago-en-revision", TransactionRechargeStatus.REQUESTED, TransactionDetailStatus.REQUESTED, "70");
    await line("rechazada", TransactionRechargeStatus.REJECTED, TransactionDetailStatus.REJECTED, "50");
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await testDatabase.drop();
  });

  it("suma solo lo aprobado o en proceso que aún no se acreditó", async () => {
    const pautas = await repository.listPautasByClient(clientId);
    expect(pautas.map(({ platform, currentBalance, pendingAmount }) => ({ platform, currentBalance, pendingAmount }))).toEqual([
      { platform: AdvertisingPlatform.GOOGLE, currentBalance: 0, pendingAmount: 0 },
      { platform: AdvertisingPlatform.META, currentBalance: 30, pendingAmount: 140.5 },
    ]);
  });

  async function line(id: string, rechargeStatus: string, detailStatus: string, amount: string, pausedAt: Date | null = null) {
    const pauta = new Prisma.Decimal(amount);
    await prisma.rechargeTransaction.create({ data: {
      id: `camino-${id}`, code: `TX-CAMINO-${id}`, idempotencyKey: `camino-${id}`, clientId, accountId: "camino-account",
      accountTypeSnapshot: AccountType.POSTPAID, rechargeStatus, pautaAmount: pauta, isdAmount: 0, agencyFeeAmount: 0,
      vatBaseAmount: pauta, vatAmount: 0, totalAmount: pauta,
      details: { create: {
        id: `camino-${id}-detail`, pautaId: "camino-meta", platformSnapshot: AdvertisingPlatform.META, requestedAmount: pauta,
        isdAmount: 0, agencyFeeAmount: 0, vatBaseAmount: pauta, vatAmount: 0, totalAmount: pauta, status: detailStatus, pausedAt,
      } },
    } });
  }
});
