import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ManagerScope } from "../../../common/access/manager-scope";
import { ApplicationError } from "../../../common/errors/application.error";
import { PrismaService } from "../../../database/prisma.service";
import { ClientAdminRepository, UpdateClientInput } from "../application/ports/client-admin.repository";
import { PreparedCredentials } from "../application/ports/client-credentials.port";
import { ClientProfileInput } from "../domain/client-profile";
import { AccountType, AdvertisingPlatform } from "../../recharges/domain/recharge.types";
import { pausePlatformDetails } from "../../recharges/infrastructure/persistence/platform-lifecycle";

const clientInclude = {
  pautas: true,
  accounts: true,
  // El gestor responsable se muestra en la fila de Clientes; solo hace falta
  // como quien lo lee, no el registro entero.
  manager: { select: { id: true, username: true } },
  // "Recargado" = lo que efectivamente llegó a las pautas: monto de pauta de
  // las transacciones completadas, sin comisiones ni impuestos.
  rechargeTransactions: {
    where: { rechargeStatus: "COMPLETED" },
    select: { pautaAmount: true },
  },
};

type ClientRecord = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

/* Sin managerId el where queda vacio y la consulta no se recorta: ese es el
   admin. Con managerId, la base solo devuelve la cartera de ese gestor. */
const managerWhere = (scope: ManagerScope): Prisma.ClientWhereInput => (scope.managerId ? { managerId: scope.managerId } : {});

@Injectable()
export class PrismaClientAdminRepository implements ClientAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ClientProfileInput, credentials: Pick<PreparedCredentials, "username" | "passwordHash">, managerId: string | null = null) {
    try {
      const clientId = randomUUID();
      const accountId = randomUUID();
      /* Cliente, cuenta, pautas y usuario en una sola transaccion: si el
         UNIQUE de username choca, no queda un cliente sin acceso a medias. */
      const record = await this.prisma.$transaction(async (database) => {
        /* El gestor se comprueba dentro de la transaccion: si entre la
           validacion y el alta lo dieran de baja, el cliente no nace colgando
           de una cartera inactiva. */
        if (managerId) {
          const manager = await database.authUser.findFirst({ where: { id: managerId, role: "GESTOR", status: "ACTIVE" }, select: { id: true } });
          if (!manager) throw new ApplicationError("MANAGER_NOT_ACTIVE", "El gestor no existe o no esta activo", 409);
        }
        const created = await database.client.create({
          data: {
            id: clientId,
            name: input.name.trim(),
            email: input.email.trim().toLowerCase(),
            status: "ACTIVE",
            managerId,
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
              },
            },
          },
          include: clientInclude,
        });
        await database.authUser.create({
          data: {
            username: credentials.username,
            passwordHash: credentials.passwordHash,
            role: "CLIENT",
            clientId,
            accountId,
            accountType: input.accountType,
            status: "ACTIVE",
            mustChangePassword: true,
          },
        });
        return created;
      });
      return this.toView(record);
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async list(scope: ManagerScope) {
    const records = await this.prisma.client.findMany({ where: managerWhere(scope), include: clientInclude, orderBy: { createdAt: "desc" } });
    return records.map((record) => this.toView(record));
  }

  /* findFirst y no findUnique: con el recorte del gestor la busqueda deja de
     ser por clave unica, y un cliente ajeno devuelve null, no el registro. */
  async findById(id: string, scope: ManagerScope) {
    const record = await this.prisma.client.findFirst({ where: { id, ...managerWhere(scope) }, include: clientInclude });
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
            await database.campaignActivationRequest.updateMany({
              where: { clientId: id, platform, status: { in: ["PENDING", "IN_REVIEW"] } },
              data: { status: "APPROVED", pautaId: pauta.id, activeRequestKey: null, reviewedBy: actorId, reviewedAt: new Date(), version: { increment: 1 } },
            });
            await database.platformLifecycleAudit.create({ data: { clientId: id, pautaId: pauta.id, action: existing ? "REACTIVATE" : "ACTIVATE", actorId } });
          }
        }
      });
      return this.findById(id, {});
    } catch (error) {
      this.handlePersistenceError(error);
    }
  }

  async assignManager(id: string, managerId: string | null) {
    if (managerId) {
      const manager = await this.prisma.authUser.findFirst({ where: { id: managerId, role: "GESTOR", status: "ACTIVE" }, select: { id: true } });
      if (!manager) return undefined;
    }
    const updated = await this.prisma.client.updateMany({ where: { id }, data: { managerId } });
    return updated.count === 1 ? this.findById(id, {}) : null;
  }

  async deactivate(id: string) {
    const current = await this.prisma.client.findUnique({ where: { id } });
    if (!current) return null;
    await this.prisma.$transaction([
      this.prisma.client.update({ where: { id }, data: { status: "INACTIVE" } }),
      this.prisma.account.updateMany({ where: { clientId: id }, data: { status: "INACTIVE" } }),
    ]);
    return this.findById(id, {});
  }

  private toView(record: ClientRecord) {
    const account = record.accounts[0];
    if (!account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "El cliente no tiene una cuenta asociada", 409);
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      manager: record.manager ? { id: record.manager.id, username: record.manager.username } : null,
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
      totalRecharged: record.rechargeTransactions
        .reduce((total, transaction) => total.add(transaction.pautaAmount), new Prisma.Decimal(0))
        .toNumber(),
    };
  }

  private handlePersistenceError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      /* El mismo codigo cubre dos UNIQUE distintos. Distinguirlos importa: el
         correo lo corrige quien crea el cliente, el usuario no. */
      const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]).join(",") : String(error.meta?.target ?? "");
      if (target.includes("username")) throw new ApplicationError("USERNAME_TAKEN", "El usuario derivado del correo ya existe", 409);
      throw new ApplicationError("CLIENT_EMAIL_EXISTS", "Ya existe un cliente con este correo", 409);
    }
    throw error;
  }
}
