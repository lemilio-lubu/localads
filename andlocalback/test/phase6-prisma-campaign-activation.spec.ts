import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { ActivationRequestStatus, PautaStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { PrismaCampaignActivationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-campaign-activation.repository";
import { validRuc } from "./ruc-fixture";

describe("persistencia de primera pauta fase 6", () => {
  let directory: string;
  let prisma: PrismaClient;
  let repository: PrismaCampaignActivationRepository;
  const clientId = "phase6-client";
  const accountId = "phase6-account";

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-phase6-"));
    const databasePath = join(directory, "phase6.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    repository = new PrismaCampaignActivationRepository(prisma as PrismaService);
    await prisma.client.create({
      data: { id: clientId, name: "Cliente Fase 6", email: "phase6@example.test", status: "ACTIVE" },
    });
    await prisma.account.create({
      data: { id: accountId, clientId, status: "ACTIVE", type: AccountType.PREPAID },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("protege solicitudes concurrentes para el mismo cliente y plataforma", async () => {
    const results = await Promise.allSettled([
      repository.create(request("duplicate-a", AdvertisingPlatform.META)),
      repository.create(request("duplicate-b", AdvertisingPlatform.META)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    expect(rejected.reason).toMatchObject({ code: "ACTIVATION_REQUEST_DUPLICATE" });
    expect(await prisma.campaignActivationRequest.count({
      where: { clientId, platform: AdvertisingPlatform.META, status: { in: ["PENDING", "IN_REVIEW"] } },
    })).toBe(1);
  });

  it("usa CAS al pasar a revision", async () => {
    const current = (await repository.list({ clientId, status: ActivationRequestStatus.PENDING }))[0];
    const reviewed = await repository.startReview({
      requestId: current.id,
      administratorId: "admin-review",
      expectedVersion: current.version,
      decidedAt: new Date("2026-09-10T12:00:00.000Z"),
    });

    expect(reviewed).toMatchObject({ status: ActivationRequestStatus.IN_REVIEW, reviewedBy: "admin-review", version: 1 });
    await expect(repository.startReview({
      requestId: current.id,
      administratorId: "other-admin",
      expectedVersion: current.version,
      decidedAt: new Date(),
    })).rejects.toMatchObject({ code: "ACTIVATION_REQUEST_ALREADY_RESOLVED" });
  });

  it("aprobar crea y enlaza una sola Pauta ACTIVE sin crear transaccion ni pago", async () => {
    const current = (await repository.list({ clientId, status: ActivationRequestStatus.IN_REVIEW }))[0];
    const approved = await repository.approve({
      requestId: current.id,
      pautaId: "phase6-meta-pauta",
      administratorId: "admin-approve",
      expectedVersion: current.version,
      decidedAt: new Date("2026-09-10T13:00:00.000Z"),
    });

    expect(approved).toMatchObject({ status: ActivationRequestStatus.APPROVED, pautaId: "phase6-meta-pauta" });
    const pauta = await prisma.pauta.findUnique({ where: { id: "phase6-meta-pauta" } });
    expect(pauta).toMatchObject({
      clientId,
      platform: AdvertisingPlatform.META,
      status: PautaStatus.ACTIVE,
    });
    expect(pauta?.externalAccountId).toMatch(/^external-duplicate-[ab]$/);
    expect(await prisma.rechargeTransaction.count({ where: { clientId } })).toBe(0);
    expect(await prisma.payment.count({ where: { transaction: { clientId } } })).toBe(0);
  });

  it("rechazar libera la llave activa y no crea una pauta", async () => {
    const created = await repository.create(request("reject", AdvertisingPlatform.GOOGLE));
    const rejected = await repository.reject({
      requestId: created.id,
      administratorId: "admin-reject",
      expectedVersion: created.version,
      reason: "Datos externos no verificables",
      decidedAt: new Date("2026-09-10T14:00:00.000Z"),
    });

    expect(rejected).toMatchObject({ status: ActivationRequestStatus.REJECTED, rejectionReason: "Datos externos no verificables" });
    expect(await prisma.pauta.findUnique({
      where: { clientId_platform: { clientId, platform: AdvertisingPlatform.GOOGLE } },
    })).toBeNull();
    await expect(repository.create(request("after-reject", AdvertisingPlatform.GOOGLE))).resolves.toMatchObject({
      status: ActivationRequestStatus.PENDING,
    });
  });

  it("approve y reject concurrentes dejan una sola decision coherente", async () => {
    const created = await repository.create(request("race", AdvertisingPlatform.TIKTOK));
    const decision = {
      requestId: created.id,
      administratorId: "admin-race",
      expectedVersion: created.version,
      decidedAt: new Date("2026-09-10T15:00:00.000Z"),
    };
    const outcomes = await Promise.allSettled([
      repository.approve({ ...decision, pautaId: "phase6-tiktok-pauta" }),
      repository.reject({ ...decision, reason: "Rechazo concurrente" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const current = await repository.findById(created.id);
    expect([ActivationRequestStatus.APPROVED, ActivationRequestStatus.REJECTED]).toContain(current?.status);
    expect(await prisma.pauta.count({ where: { clientId, platform: AdvertisingPlatform.TIKTOK } }))
      .toBe(current?.status === ActivationRequestStatus.APPROVED ? 1 : 0);
  });

  it("una pauta existente en cualquier estado bloquea una nueva primera activacion", async () => {
    await prisma.pauta.update({ where: { id: "phase6-meta-pauta" }, data: { status: PautaStatus.SUSPENDED } });
    await expect(repository.create(request("existing", AdvertisingPlatform.META)))
      .rejects.toMatchObject({ code: "PAUTA_ALREADY_EXISTS" });
  });

  it("lista por ownership y carga el contexto de cuenta", async () => {
    const ownership = await repository.loadAccountContext(accountId);
    expect(ownership).toMatchObject({ client: { id: clientId }, account: { id: accountId, clientId } });
    const own = await repository.list({ clientId });
    expect(own.length).toBeGreaterThanOrEqual(3);
    expect(own.every((record) => record.clientId === clientId)).toBe(true);
  });

  it("el onboarding administrativo crea Pauta ACTIVE junto al Campaign legacy", async () => {
    const clients = new PrismaClientAdminRepository(prisma as PrismaService);
    const created = await clients.create({
      name: "Cliente onboarding Fase 6",
      email: "phase6-onboarding@example.test",
      ruc: validRuc(),
      accountType: AccountType.PREPAID,
      creditDays: 0,
      platforms: [AdvertisingPlatform.META, AdvertisingPlatform.GOOGLE],
    }, { username: "phase6-onboarding", passwordHash: "scrypt$salt$hash" });

    const pautas = await prisma.pauta.findMany({ where: { clientId: created.id }, orderBy: { platform: "asc" } });
    expect(pautas.map(({ platform, status }) => ({ platform, status }))).toEqual([
      { platform: AdvertisingPlatform.GOOGLE, status: PautaStatus.ACTIVE },
      { platform: AdvertisingPlatform.META, status: PautaStatus.ACTIVE },
    ]);
    expect(pautas.every((pauta) => pauta.currentBalance.toString() === "0" && pauta.activatedAt !== null)).toBe(true);
  });

  function request(id: string, platform: AdvertisingPlatform) {
    return {
      id: `activation-${id}`,
      clientId,
      platform,
      requesterName: "Persona solicitante",
      externalAccountId: `external-${id}`,
      phone: "+593999999999",
      firstRechargeAmount: "100.00",
    };
  }
});
