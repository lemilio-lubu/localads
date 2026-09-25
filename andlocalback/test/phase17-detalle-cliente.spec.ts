import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { validRuc } from "./ruc-fixture";

/* La ficha del cliente reparte por plataforma en dinero solicitado. Antes la
   pantalla contaba en cuántas recargas aparecía cada plataforma y enseñaba
   porcentajes al revés de la realidad. */
describe("Fase 17 - reparto por plataforma del detalle de cliente", () => {
  let directory: string;
  let prisma: PrismaClient;
  let clients: PrismaClientAdminRepository;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-detail-"));
    const database = join(directory, "test.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), database);
    prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
    clients = new PrismaClientAdminRepository(prisma as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary path");
    rmSync(directory, { recursive: true, force: true });
  });

  async function recharge(clientId: string, accountId: string, lines: Array<{ pautaId: string; platform: string; amount: number }>, rechargeStatus = "APPROVED") {
    const pautaAmount = lines.reduce((sum, line) => sum + line.amount, 0);
    await prisma.rechargeTransaction.create({ data: {
      code: randomUUID(), idempotencyKey: randomUUID(), clientId, accountId,
      accountTypeSnapshot: "POSTPAGO", rechargeStatus, pautaAmount, totalAmount: pautaAmount,
      details: { create: lines.map((line) => ({ pautaId: line.pautaId, platformSnapshot: line.platform, requestedAmount: line.amount, isdAmount: 0, agencyFeeAmount: 0, vatBaseAmount: line.amount, vatAmount: 0, totalAmount: line.amount })) },
    } });
  }

  it("reparte en dinero solicitado y no cuenta las recargas rechazadas", async () => {
    const client = await clients.create({ name: "Detalle", email: `${randomUUID()}@example.test`, ruc: validRuc(), accountType: AccountType.POSTPAID, creditDays: 5, platforms: [AdvertisingPlatform.META, AdvertisingPlatform.GOOGLE] }, { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" }, null);
    const pautas = await prisma.pauta.findMany({ where: { clientId: client.id } });
    const meta = pautas.find((pauta) => pauta.platform === "META")!;
    const google = pautas.find((pauta) => pauta.platform === "GOOGLE")!;
    // Meta aparece en 1 recarga y Google en 2, pero Meta lleva más dinero.
    await recharge(client.id, client.account.id, [{ pautaId: meta.id, platform: "META", amount: 500 }, { pautaId: google.id, platform: "GOOGLE", amount: 300 }]);
    await recharge(client.id, client.account.id, [{ pautaId: google.id, platform: "GOOGLE", amount: 150 }]);
    await recharge(client.id, client.account.id, [{ pautaId: meta.id, platform: "META", amount: 999 }], "REJECTED");

    expect((await clients.findDetail(client.id, {}))!.platformSummary).toEqual([
      { platform: "META", requested: 500, operations: 1 },
      { platform: "GOOGLE", requested: 450, operations: 2 },
      { platform: "TIKTOK", requested: 0, operations: 0 },
    ]);
  });

  it("el gestor no ve el detalle de un cliente fuera de su cartera", async () => {
    const client = await clients.create({ name: "Ajeno", email: `${randomUUID()}@example.test`, ruc: validRuc(), accountType: AccountType.PREPAID, creditDays: 0, platforms: [AdvertisingPlatform.META] }, { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" }, null);
    await expect(clients.findDetail(client.id, { managerId: "gestor-que-no-es" })).resolves.toBeNull();
  });
});
