import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { PrismaCampaignActivationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-campaign-activation.repository";
import { PrismaTransactionExecutionRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-transaction-execution.repository";
import { PrismaPhase7QueryRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-phase7-query.repository";
import { assertRechargePlatforms } from "../src/modules/recharges/infrastructure/persistence/platform-lifecycle";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { RequestCampaignActivation } from "../src/modules/recharges/application/use-cases/request-campaign-activation";
import { seedBackendData } from "../src/database/seed-data";

describe("ciclo de plataformas y recargas en stop", () => {
  let directory: string;
  let prisma: PrismaClient;
  let clients: PrismaClientAdminRepository;
  let activation: PrismaCampaignActivationRepository;
  let execution: PrismaTransactionExecutionRepository;
  let queries: PrismaPhase7QueryRepository;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-lifecycle-"));
    const database = join(directory, "test.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), database);
    prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
    clients = new PrismaClientAdminRepository(prisma as PrismaService);
    activation = new PrismaCampaignActivationRepository(prisma as PrismaService);
    execution = new PrismaTransactionExecutionRepository(prisma as PrismaService);
    queries = new PrismaPhase7QueryRepository(prisma as PrismaService);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary path");
    rmSync(directory, { recursive: true, force: true });
  });

  async function fixture() {
    const client = await clients.create({ name: "Lifecycle", email: `${randomUUID()}@example.test`, accountType: AccountType.POSTPAID, creditDays: 30, platforms: [AdvertisingPlatform.META, AdvertisingPlatform.GOOGLE] });
    const pautas = await prisma.pauta.findMany({ where: { clientId: client.id } });
    const meta = pautas.find((p) => p.platform === "META")!;
    const google = pautas.find((p) => p.platform === "GOOGLE")!;
    await prisma.pauta.update({ where: { id: meta.id }, data: { currentBalance: 77, externalAccountId: "original-meta-id" } });
    const transaction = await prisma.rechargeTransaction.create({ data: {
      code: randomUUID(), idempotencyKey: randomUUID(), clientId: client.id, accountId: client.account.id,
      accountTypeSnapshot: "POSTPAGO", rechargeStatus: "APPROVED", pautaAmount: 200, totalAmount: 264.50,
      details: { create: [meta, google].map((p) => ({ pautaId: p.id, platformSnapshot: p.platform, requestedAmount: 100, isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25, totalAmount: 132.25, status: "APPROVED" })) },
      payment: { create: { status: "IN_CREDIT", expectedAmount: 264.50 } },
    }, include: { details: true, payment: true } });
    const detail = transaction.details.find((d) => d.pautaId === meta.id)!;
    return { client, meta, google, transaction, detail };
  }
  async function setPlatforms(clientId: string, platforms: AdvertisingPlatform[], version?: number) {
    const current = await clients.findById(clientId);
    return clients.update(clientId, { platforms, expectedPlatformsVersion: version ?? current!.platformsVersion, administratorId: "admin-test" });
  }
  async function request(client: Awaited<ReturnType<typeof fixture>>["client"]) {
    return new RequestCampaignActivation(activation, { generate: randomUUID }).execute({ accountId: client.account.id, platform: AdvertisingPlatform.META, requesterName: "Solicitante", externalAccountId: "original-meta-id", phone: "0999999999", firstRechargeAmount: 100 });
  }

  it("da de baja sin borrar saldo, identidad, pago ni detalles; permite cero plataformas", async () => {
    const { client, meta, transaction } = await fixture();
    await setPlatforms(client.id, []);
    expect((await clients.findById(client.id))!.account.platforms).toEqual([]);
    const pauta = await prisma.pauta.findUniqueOrThrow({ where: { id: meta.id } });
    expect(pauta.status).toBe("INACTIVE"); expect(pauta.currentBalance.toNumber()).toBe(77);
    expect(pauta.externalAccountId).toBe("original-meta-id");
    expect(await prisma.payment.findUnique({ where: { id: transaction.payment!.id } })).toEqual(transaction.payment);
    expect(await prisma.transactionDetail.count({ where: { transactionId: transaction.id, pausedAt: { not: null } } })).toBe(2);
    expect(await prisma.campaign.count({ where: { accountId: client.account.id } })).toBe(2);
  });

  it("deja avanzar otra plataforma y exige reanudación manual tras reactivar", async () => {
    const { client, meta, transaction, detail } = await fixture();
    await setPlatforms(client.id, [AdvertisingPlatform.GOOGLE]);
    const context = (await execution.loadExecutionContext(transaction.id))!;
    const started = await execution.startTransaction(transaction.id, context.version, new Date());
    expect(started.details.find((d) => d.id === detail.id)!.status).toBe("APPROVED");
    expect(started.details.find((d) => d.id !== detail.id)!.status).toBe("PROCESSING");
    await expect(execution.resumeDetail(transaction.id, detail.id, "admin-test")).rejects.toMatchObject({ code: "PAUTA_NOT_ACTIVE" });
    await setPlatforms(client.id, [AdvertisingPlatform.GOOGLE, AdvertisingPlatform.META]);
    expect((await prisma.transactionDetail.findUniqueOrThrow({ where: { id: detail.id } })).pausedAt).not.toBeNull();
    const complete = { transactionId: transaction.id, detailId: detail.id, effectiveAmount: MonetaryAmount.fromMajorUnits(100), effectiveRechargeDate: new Date(), completedAt: new Date() };
    await expect(execution.completeTransactionDetail(complete)).rejects.toMatchObject({ code: "DETAIL_PAUSED" });
    await execution.resumeDetail(transaction.id, detail.id, "admin-test");
    const completed = await execution.completeTransactionDetail(complete);
    expect(completed.pautaBalance).toBe(177);
    expect(await prisma.platformLifecycleAudit.count({ where: { pautaId: meta.id, action: "RESUME", actorId: "admin-test" } })).toBe(1);
    await expect(execution.resumeDetail(transaction.id, detail.id, "admin-test")).rejects.toMatchObject({ code: "DETAIL_NOT_PAUSED" });
  });

  it("permite varios ciclos de reactivación sin duplicar pauta ni perder solicitudes anteriores", async () => {
    const { client, meta } = await fixture();
    for (let i = 0; i < 2; i++) {
      await setPlatforms(client.id, [AdvertisingPlatform.GOOGLE]);
      const pending = await request(client);
      expect(pending).toMatchObject({ kind: "REACTIVATION", pautaId: meta.id });
      await expect(request(client)).rejects.toMatchObject({ code: "ACTIVATION_REQUEST_DUPLICATE" });
      const approved = await activation.approve({ requestId: pending.id, expectedVersion: pending.version, pautaId: randomUUID(), administratorId: "admin-test", decidedAt: new Date() });
      expect(approved.pautaId).toBe(meta.id);
    }
    expect(await prisma.pauta.count({ where: { clientId: client.id, platform: "META" } })).toBe(1);
    expect(await prisma.campaignActivationRequest.count({ where: { pautaId: meta.id, status: "APPROVED" } })).toBe(2);
    const pauta = await prisma.pauta.findUniqueOrThrow({ where: { id: meta.id } });
    expect(pauta.currentBalance.toNumber()).toBe(77); expect(pauta.externalAccountId).toBe("original-meta-id");
    expect((await clients.findById(client.id))!.account.platforms).toContain("META");
  });

  it("el alta directa resuelve la solicitud pendiente y rechaza la aprobación antigua", async () => {
    const { client, meta } = await fixture();
    await setPlatforms(client.id, [AdvertisingPlatform.GOOGLE]);
    const pending = await request(client);
    await setPlatforms(client.id, [AdvertisingPlatform.GOOGLE, AdvertisingPlatform.META]);
    expect(await activation.findById(pending.id)).toMatchObject({ status: "APPROVED", pautaId: meta.id, reviewedBy: "admin-test" });
    await expect(activation.approve({ requestId: pending.id, expectedVersion: pending.version, pautaId: randomUUID(), administratorId: "other-admin", decidedAt: new Date() })).rejects.toMatchObject({ code: "ACTIVATION_REQUEST_ALREADY_RESOLVED" });
  });

  it("rechaza una edición administrativa antigua tras aprobar una solicitud", async () => {
    const { client } = await fixture();
    const pending = await activation.create({ id: randomUUID(), clientId: client.id, platform: AdvertisingPlatform.TIKTOK, requesterName: "Test", externalAccountId: "new-tiktok", phone: "0999999999", firstRechargeAmount: "100.00" });
    await activation.approve({ requestId: pending.id, expectedVersion: pending.version, pautaId: randomUUID(), administratorId: "admin-test", decidedAt: new Date() });
    await expect(setPlatforms(client.id, [AdvertisingPlatform.GOOGLE], client.platformsVersion)).rejects.toMatchObject({ code: "PLATFORMS_CHANGED" });
    expect((await clients.findById(client.id))!.account.platforms).toHaveLength(3);
  });

  it("rechaza nuevas recargas con contexto anterior a la baja y con pautas ajenas", async () => {
    const { client, meta } = await fixture();
    await setPlatforms(client.id, []);
    await expect(prisma.$transaction((db) => assertRechargePlatforms(db, client.id, client.account.id, [meta.id]))).rejects.toMatchObject({ code: "PAUTA_NOT_ACTIVE" });
    const other = await fixture();
    await expect(prisma.$transaction((db) => assertRechargePlatforms(db, other.client.id, other.client.account.id, [meta.id]))).rejects.toMatchObject({ code: "PAUTA_NOT_ACTIVE" });
  });

  it("no pausa completados y expone stop en consultas de cliente y administrador", async () => {
    const { client, transaction, detail } = await fixture();
    await prisma.transactionDetail.update({ where: { id: detail.id }, data: { status: "COMPLETED" } });
    await setPlatforms(client.id, []);
    expect((await queries.findTransactionDetail(transaction.id))!.details.find((d) => d.id === detail.id)!.pausedAt).toBeNull();
    const own = await queries.findTransactionDetailByClient({ clientId: client.id, transactionId: transaction.id });
    expect(own!.details.filter((d) => d.pausedAt)).toHaveLength(1);
    expect((await queries.listTransactionsByClient({ clientId: client.id, page: 1, pageSize: 10 })).items[0].pausedDetails).toBe(1);
    expect(await queries.findTransactionDetailByClient({ clientId: "another-client", transactionId: transaction.id })).toBeNull();
  });

  it("rechaza reanudación si el pago prepago no está confirmado", async () => {
    const { client, transaction, detail } = await fixture();
    await setPlatforms(client.id, []);
    await setPlatforms(client.id, [AdvertisingPlatform.META]);
    await prisma.rechargeTransaction.update({ where: { id: transaction.id }, data: { accountTypeSnapshot: "PREPAGO" } });
    await expect(execution.resumeDetail(transaction.id, detail.id, "admin-test")).rejects.toMatchObject({ code: "PAYMENT_NOT_CONFIRMED" });
    await prisma.payment.update({ where: { transactionId: transaction.id }, data: { status: "PAID" } });
    await execution.resumeDetail(transaction.id, detail.id, "admin-test");
    expect((await prisma.transactionDetail.findUniqueOrThrow({ where: { id: detail.id } })).status).toBe("APPROVED");
  });

  it("rechazar reactivación conserva la pauta inactiva y admite otra solicitud", async () => {
    const { client, meta } = await fixture();
    await setPlatforms(client.id, []);
    const pending = await request(client);
    await activation.reject({ requestId: pending.id, expectedVersion: pending.version, administratorId: "admin-test", reason: "Revisar datos", decidedAt: new Date() });
    expect((await prisma.pauta.findUniqueOrThrow({ where: { id: meta.id } })).status).toBe("INACTIVE");
    expect((await request(client)).id).not.toBe(pending.id);
  });

  it("el arranque no reactiva plataformas dadas de baja", async () => {
    await seedBackendData(prisma);
    await setPlatforms("client-001", []);
    await seedBackendData(prisma);
    expect((await clients.findById("client-001"))!.account.platforms).toEqual([]);
    expect(await prisma.campaign.count({ where: { accountId: "account-prepaid-001", status: "ACTIVE" } })).toBe(0);
  });

  it("dos administradores no reanudan dos veces ni reutilizan una versión anterior", async () => {
    const { client, transaction, detail } = await fixture();
    await setPlatforms(client.id, []);
    await setPlatforms(client.id, [AdvertisingPlatform.META]);
    const paused = await prisma.transactionDetail.findUniqueOrThrow({ where: { id: detail.id } });
    const outcomes = await Promise.allSettled([
      execution.resumeDetail(transaction.id, detail.id, "admin-a", paused.version),
      execution.resumeDetail(transaction.id, detail.id, "admin-b", paused.version),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.platformLifecycleAudit.count({ where: { detailId: detail.id, action: "RESUME" } })).toBe(1);
    await setPlatforms(client.id, []);
    await setPlatforms(client.id, [AdvertisingPlatform.META]);
    await expect(execution.resumeDetail(transaction.id, detail.id, "admin-a", paused.version)).rejects.toMatchObject({ code: "DETAIL_CONCURRENTLY_MODIFIED" });
    expect((await prisma.transactionDetail.findUniqueOrThrow({ where: { id: detail.id } })).pausedAt).not.toBeNull();
  });

  it("una baja concurrente con la aprobación de solicitud nunca duplica la pauta", async () => {
    const { client } = await fixture();
    const pending = await activation.create({ id: randomUUID(), clientId: client.id, platform: AdvertisingPlatform.TIKTOK, requesterName: "Test", externalAccountId: "tiktok", phone: "0999999999", firstRechargeAmount: "100.00" });
    await Promise.allSettled([
      setPlatforms(client.id, [], client.platformsVersion),
      activation.approve({ requestId: pending.id, expectedVersion: pending.version, pautaId: randomUUID(), administratorId: "admin-test", decidedAt: new Date() }),
    ]);
    expect(await prisma.pauta.count({ where: { clientId: client.id, platform: "TIKTOK" } })).toBeLessThanOrEqual(1);
    const pautas = await prisma.pauta.findMany({ where: { clientId: client.id, status: "ACTIVE" } });
    const campaigns = await prisma.campaign.findMany({ where: { accountId: client.account.id, status: "ACTIVE" } });
    expect(campaigns.map((c) => c.platform).sort()).toEqual(pautas.map((p) => p.platform).sort());
  });
});
