import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../../common/errors/application.error";

export async function syncLegacyPlatform(database: Prisma.TransactionClient, clientId: string, platform: string, status: string) {
  const accounts = await database.account.findMany({ where: { clientId }, select: { id: true } });
  for (const account of accounts) {
    await database.campaign.upsert({
      where: { accountId_platform: { accountId: account.id, platform } },
      create: { id: randomUUID(), accountId: account.id, platform, status },
      update: { status },
    });
  }
}

export async function pausePlatformDetails(database: Prisma.TransactionClient, clientId: string, pautaId: string, actorId: string) {
  const details = await database.transactionDetail.findMany({
    where: { pautaId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] }, pausedAt: null },
    select: { id: true },
  });
  if (!details.length) return;
  await database.transactionDetail.updateMany({
    where: { id: { in: details.map(({ id }) => id) } },
    data: { pausedAt: new Date(), version: { increment: 1 } },
  });
  await database.platformLifecycleAudit.createMany({
    data: details.map(({ id }) => ({ id: randomUUID(), clientId, pautaId, detailId: id, action: "PAUSE", actorId })),
  });
}

// This write participates in the same transaction as recharge creation, so a
// concurrent platform removal cannot pass an earlier, stale context check.
export async function assertRechargePlatforms(database: Prisma.TransactionClient, clientId: string, accountId: string, pautaIds: string[]) {
  const account = await database.account.findFirst({ where: { id: accountId, clientId, status: "ACTIVE", client: { status: "ACTIVE" } } });
  if (!account) throw new ApplicationError("ACCOUNT_INACTIVE", "La cuenta no está activa", 409);
  const result = await database.pauta.updateMany({
    where: { id: { in: pautaIds }, clientId, status: "ACTIVE" },
    data: { version: { increment: 1 } },
  });
  if (result.count !== new Set(pautaIds).size) throw new ApplicationError("PAUTA_NOT_ACTIVE", "Una plataforma fue desactivada. Revisa los montos antes de recargar", 409);
}
