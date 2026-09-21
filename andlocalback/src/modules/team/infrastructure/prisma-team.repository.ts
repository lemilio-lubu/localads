import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApplicationError } from "../../../common/errors/application.error";
import { PrismaService } from "../../../database/prisma.service";
import { TEAM_ROLES, TeamMemberInput, TeamRole } from "../domain/team-member";
import {
  TeamFilters,
  TeamMemberDetailView,
  TeamMemberView,
  TeamRepository,
  UpdateTeamMemberInput,
} from "../application/ports/team.repository";

type MemberRecord = Prisma.AuthUserGetPayload<Record<string, never>>;

const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

@Injectable()
export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: TeamFilters): Promise<readonly TeamMemberView[]> {
    /* Solo usuarios internos: el rol CLIENT queda fuera por construccion, no
       por un filtro que alguien pueda quitar desde la query. */
    const records = await this.prisma.authUser.findMany({
      where: {
        role: filters.role ?? { in: [...TEAM_ROLES] },
        status: filters.status,
        ...(filters.search ? { username: { contains: filters.search } } : {}),
      },
      orderBy: [{ role: "asc" }, { username: "asc" }],
    });
    /* Dos consultas agregadas para todo el listado, no una por fila: con N
       usuarios seria N+1 y la pantalla lo nota en cuanto crece el equipo. */
    const ids = records.map((record) => record.id);
    const [clients, sales] = await Promise.all([
      this.prisma.client.groupBy({ by: ["managerId"], where: { managerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.rechargeTransaction.groupBy({
        by: ["clientId"],
        where: { rechargeStatus: "COMPLETED", client: { is: { managerId: { in: ids } } } },
        _count: { _all: true },
      }).then(async (rows) => {
        if (!rows.length) return new Map<string, number>();
        const owners = await this.prisma.client.findMany({ where: { id: { in: rows.map((row) => row.clientId) } }, select: { id: true, managerId: true } });
        const byClient = new Map(owners.map((owner) => [owner.id, owner.managerId]));
        const totals = new Map<string, number>();
        for (const row of rows) {
          const managerId = byClient.get(row.clientId);
          if (managerId) totals.set(managerId, (totals.get(managerId) ?? 0) + row._count._all);
        }
        return totals;
      }),
    ]);
    const clientsByManager = new Map(clients.map((row) => [row.managerId ?? "", row._count._all]));
    return records.map((record) => this.toView(record, { clients: clientsByManager.get(record.id) ?? 0, sales: sales.get(record.id) ?? 0 }));
  }

  async findById(id: string): Promise<TeamMemberDetailView | null> {
    const record = await this.prisma.authUser.findFirst({ where: { id, role: { in: [...TEAM_ROLES] } } });
    if (!record) return null;
    const clients = await this.prisma.client.findMany({ where: { managerId: id }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } });
    const sales = await this.prisma.rechargeTransaction.findMany({
      where: { rechargeStatus: "COMPLETED", client: { is: { managerId: id } } },
      select: { id: true, code: true, clientId: true, pautaAmount: true, totalAmount: true, createdAt: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      ...this.toView(record, { clients: clients.length, sales: sales.length }),
      clients: clients.map((client) => ({ id: client.id, name: client.name, status: client.status as "ACTIVE" | "INACTIVE" })),
      sales: sales.map((sale) => ({
        id: sale.id, code: sale.code, clientId: sale.clientId, clientName: sale.client.name,
        pautaAmount: money(sale.pautaAmount), totalAmount: money(sale.totalAmount), createdAt: sale.createdAt.toISOString(),
      })),
    };
  }

  async create(input: TeamMemberInput, credentials: Readonly<{ username: string; passwordHash: string }>, createdById: string) {
    try {
      const record = await this.prisma.authUser.create({
        data: {
          username: credentials.username,
          passwordHash: credentials.passwordHash,
          role: input.role,
          note: input.note ?? null,
          createdById,
          status: "ACTIVE",
          mustChangePassword: true,
        },
      });
      return this.toView(record, { clients: 0, sales: 0 });
    } catch (error) {
      throw usernameConflict(error);
    }
  }

  async update(id: string, input: UpdateTeamMemberInput) {
    try {
      const record = await this.prisma.authUser.update({
        where: { id },
        data: {
          ...(input.username !== undefined && { username: input.username }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.note !== undefined && { note: input.note }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      return this.toView(record, await this.metrics(id));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw usernameConflict(error);
    }
  }

  async deactivate(id: string) {
    const current = await this.prisma.authUser.findFirst({ where: { id, role: { in: [...TEAM_ROLES] } } });
    if (!current) return null;
    /* Baja y liberacion de cartera en una sola transaccion: si solo pasara una
       de las dos, quedarian clientes apuntando a un gestor inactivo. */
    const [, released] = await this.prisma.$transaction([
      this.prisma.authUser.update({ where: { id }, data: { status: "INACTIVE" } }),
      this.prisma.client.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      this.prisma.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    const record = await this.prisma.authUser.findFirstOrThrow({ where: { id } });
    return { member: this.toView(record, { clients: 0, sales: 0 }), releasedClients: released.count };
  }

  async resetPassword(id: string, passwordHash: string) {
    try {
      /* La clave nueva tambien revoca las sesiones: si la cuenta estaba en
         manos equivocadas, la sesion abierta muere con el restablecimiento. */
      const [record] = await this.prisma.$transaction([
        this.prisma.authUser.update({ where: { id }, data: { passwordHash, mustChangePassword: true } }),
        this.prisma.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      return this.toView(record, await this.metrics(id));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw error;
    }
  }

  private async metrics(id: string) {
    const [clients, sales] = await Promise.all([
      this.prisma.client.count({ where: { managerId: id } }),
      this.prisma.rechargeTransaction.count({ where: { rechargeStatus: "COMPLETED", client: { is: { managerId: id } } } }),
    ]);
    return { clients, sales };
  }

  private toView(record: MemberRecord, metrics: { clients: number; sales: number }): TeamMemberView {
    return {
      id: record.id,
      username: record.username,
      role: record.role as TeamRole,
      status: record.status as "ACTIVE" | "INACTIVE",
      note: record.note,
      mustChangePassword: record.mustChangePassword,
      createdAt: record.createdAt.toISOString(),
      metrics,
    };
  }
}

function usernameConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ApplicationError("USERNAME_TAKEN", "Ya existe un usuario con ese nombre", 409);
  }
  return error;
}
