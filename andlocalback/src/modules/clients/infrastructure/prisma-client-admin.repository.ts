import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../common/errors/application.error";
import { PrismaService } from "../../../database/prisma.service";
import { ClientAdminRepository, UpdateClientInput } from "../application/ports/client-admin.repository";
import { ClientProfileInput } from "../domain/client-profile";
import { AccountType, AdvertisingPlatform } from "../../recharges/domain/recharge.types";
import { pausePlatformDetails, syncLegacyPlatform } from "../../recharges/infrastructure/persistence/platform-lifecycle";

const clientInclude = {
  pautas: true,
  accounts: {
    include: {
      campaigns: true,
      recharges: { select: { amount: true } },
    },
  },
};

type ClientRecord = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

@Injectable()
export class PrismaClientAdminRepository implements ClientAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ClientProfileInput) {
    try {
      const clientId = randomUUID();
      const accountId = randomUUID();
      const record = await this.prisma.client.create({
        data: {
          id: clientId,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          status: "ACTIVE",
          pautas: {
            create: input.platforms.map((platform) => ({
              id: randomUUID(),
              platform,
              status: "ACTIVE",
              currentBalance: new Prisma.Decimal(0),
              activatedAt: new Date(),
            })),
          },
          accounts: {
            create: {
              id: accountId,
              status: "ACTIVE",
              type: input.accountType,
              creditDays: input.accountType === "PREPAGO" ? 0 : input.creditDays,
              campaigns: {
                create: input.platforms.map((platform) => ({ id: randomUUID(), platform, status: "ACTIVE" })),
              },
            },
          },
        },
        include: clientInclude,
      });
      return this.toView(record);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async list() {
    const records = await this.prisma.client.findMany({ include: clientInclude, orderBy: { createdAt: "desc" } });
    return records.map((record) => this.toView(record));
  }

  async findById(id: string) {
    const record = await this.prisma.client.findUnique({ where: { id }, include: clientInclude });
    return record ? this.toView(record) : null;
  }

  async update(id: string, input: UpdateClientInput) {
    const current = await this.prisma.client.findUnique({ where: { id }, include: { accounts: true } });
    const account = current?.accounts[0];
    if (!current || !account) return null;

    try {
      await this.prisma.$transaction(async (database) => {
        await database.client.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name.trim() }),
            ...(input.email !== undefined && { email: input.email.trim().toLowerCase() }),
            ...(input.status !== undefined && { status: input.status }),
          },
        });
        await database.account.update({
          where: { id: account.id },
          data: {
            ...(input.accountType !== undefined && { type: input.accountType }),
            ...(input.creditDays !== undefined && { creditDays: input.creditDays }),
            ...(input.status !== undefined && { status: input.status }),
          },
        });
        if (input.platforms) {
          const version = await database.client.updateMany({
            where: { id, platformsVersion: input.expectedPlatformsVersion ?? current.platformsVersion },
            data: { platformsVersion: { increment: 1 } },
          });
          if (version.count !== 1) throw new ApplicationError("PLATFORMS_CHANGED", "Las plataformas cambiaron. Cierra y vuelve a abrir el cliente antes de guardar", 409);
          const pautas = await database.pauta.findMany({ where: { clientId: id } });
          const actorId = input.administratorId ?? "system";
          for (const pauta of pautas) {
            if (pauta.status !== "ACTIVE" || input.platforms.includes(pauta.platform as AdvertisingPlatform)) continue;
            await database.pauta.update({ where: { id: pauta.id }, data: { status: "INACTIVE", version: { increment: 1 } } });
            await pausePlatformDetails(database, id, pauta.id, actorId);
            await syncLegacyPlatform(database, id, pauta.platform, "INACTIVE");
            await database.platformLifecycleAudit.create({ data: { clientId: id, pautaId: pauta.id, action: "DEACTIVATE", actorId } });
          }
          for (const platform of input.platforms) {
            const existing = pautas.find((pauta) => pauta.platform === platform);
            if (existing?.status === "SUSPENDED") throw new ApplicationError("PAUTA_SUSPENDED", "La plataforma está suspendida y requiere revisión administrativa", 409);
            if (existing?.status === "ACTIVE") continue;
            const pending = await database.campaignActivationRequest.findFirst({ where: { clientId: id, platform, status: { in: ["PENDING", "IN_REVIEW"] } } });
            const pauta = await database.pauta.upsert({
              where: { clientId_platform: { clientId: id, platform } },
              create: { id: randomUUID(), clientId: id, platform, status: "ACTIVE", activatedAt: new Date(), externalAccountId: pending?.externalAccountId },
              update: { status: "ACTIVE", externalAccountId: existing?.externalAccountId ?? pending?.externalAccountId, activatedAt: existing?.activatedAt ?? new Date(), version: { increment: 1 } },
            });
            await syncLegacyPlatform(database, id, platform, "ACTIVE");
            await database.campaignActivationRequest.updateMany({
              where: { clientId: id, platform, status: { in: ["PENDING", "IN_REVIEW"] } },
              data: { status: "APPROVED", pautaId: pauta.id, activeRequestKey: null, reviewedBy: actorId, reviewedAt: new Date(), version: { increment: 1 } },
            });
            await database.platformLifecycleAudit.create({ data: { clientId: id, pautaId: pauta.id, action: existing ? "REACTIVATE" : "ACTIVATE", actorId } });
          }
        }
      });
      return this.findById(id);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async deactivate(id: string) {
    const current = await this.prisma.client.findUnique({ where: { id } });
    if (!current) return null;
    await this.prisma.$transaction([
      this.prisma.client.update({ where: { id }, data: { status: "INACTIVE" } }),
      this.prisma.account.updateMany({ where: { clientId: id }, data: { status: "INACTIVE" } }),
    ]);
    return this.findById(id);
  }

  private toView(record: ClientRecord) {
    const account = record.accounts[0];
    if (!account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "El cliente no tiene una cuenta asociada", 409);
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      status: record.status as "ACTIVE" | "INACTIVE",
      createdAt: record.createdAt.toISOString(),
      platformsVersion: record.platformsVersion,
      account: {
        id: account.id,
        type: account.type as AccountType,
        status: account.status as "ACTIVE" | "INACTIVE",
        creditDays: account.creditDays,
        platforms: record.pautas.filter((pauta) => pauta.status === "ACTIVE").map((pauta) => pauta.platform as AdvertisingPlatform),
      },
      totalRecharged: account.recharges.reduce((total, recharge) => total + recharge.amount, 0),
    };
  }

  private handlePersistenceError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApplicationError("CLIENT_EMAIL_EXISTS", "Ya existe un cliente con este correo", 409);
    }
    throw error;
  }
}
