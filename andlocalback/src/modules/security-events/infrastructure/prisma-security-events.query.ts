import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { idsMatchingText } from "../../../database/text-search";
import { SecurityAuditOutcome } from "../../../common/audit/security-audit.port";
import { SecurityEventFilters, SecurityEventPage, SecurityEventsQuery } from "../application/ports/security-events.query";

/* Campos del detalle que guardan el id de una persona del equipo. */
const personDetailKeys = ["from", "to", "managerId", "reassignedTo"] as const;

@Injectable()
export class PrismaSecurityEventsQuery implements SecurityEventsQuery {
  constructor(private readonly database: PrismaService) {}

  async list(filters: SecurityEventFilters): Promise<SecurityEventPage> {
    const where: Prisma.SecurityAuditEventWhereInput = {
      AND: [
        filters.actions ? { action: { in: [...filters.actions] } } : {},
        filters.problemsOnly ? { outcome: { in: ["FAILURE", "DENIED"] } } : {},
        filters.search ? await this.searchCondition(filters.search) : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.database.securityAuditEvent.count({ where }),
      this.database.securityAuditEvent.findMany({
        where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
        select: { id: true, occurredAt: true, action: true, outcome: true, actorUserId: true, targetType: true, targetId: true, ip: true, userAgent: true, requestId: true, detail: true },
      }),
    ]);

    const detailOf = (row: (typeof rows)[number]) => (row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : null);
    const userIds = new Set<string>();
    const clientIds = new Set<string>(); const receiptIds = new Set<string>();
    for (const row of rows) {
      if (row.actorUserId) userIds.add(row.actorUserId);
      if (row.targetType === "USER" && row.targetId) userIds.add(row.targetId);
      if (row.targetType === "CLIENT" && row.targetId) clientIds.add(row.targetId);
      if (row.targetType === "RECEIPT" && row.targetId) receiptIds.add(row.targetId);
      const detail = detailOf(row);
      for (const key of personDetailKeys) if (typeof detail?.[key] === "string") userIds.add(detail[key] as string);
    }
    /* Tres consultas para toda la pagina, no una por fila. */
    const [users, clients, receipts] = await Promise.all([
      userIds.size ? this.database.authUser.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true, name: true } }) : [],
      clientIds.size ? this.database.client.findMany({ where: { id: { in: [...clientIds] } }, select: { id: true, name: true } }) : [],
      receiptIds.size ? this.database.paymentReceipt.findMany({ where: { id: { in: [...receiptIds] } }, select: { id: true, payment: { select: { transaction: { select: { code: true, client: { select: { name: true } } } } } } } }) : [],
    ]);
    const people = Object.fromEntries(users.map((user) => [user.id, user.name?.trim() || user.username]));
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));
    const receiptLabels = new Map(receipts.map((receipt) => [receipt.id, `${receipt.payment.transaction.code} · ${receipt.payment.transaction.client.name}`]));
    const targetLabel = (type: string, id: string) =>
      (type === "USER" ? people[id] : type === "CLIENT" ? clientNames.get(id) : type === "RECEIPT" ? receiptLabels.get(id) : undefined) ?? "registro eliminado";

    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        action: row.action,
        outcome: row.outcome as SecurityAuditOutcome,
        actor: row.actorUserId ? { id: row.actorUserId, label: people[row.actorUserId] ?? "usuario eliminado" } : null,
        target: row.targetType && row.targetId ? { type: row.targetType, id: row.targetId, label: targetLabel(row.targetType, row.targetId) } : null,
        ip: row.ip, userAgent: row.userAgent, requestId: row.requestId,
        detail: detailOf(row),
      })),
      page: filters.page,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      total,
      people,
    };
  }

  /* Busca por persona (del equipo o cliente, por nombre o correo) y por el
     codigo de referencia que se ve en un error: soporte lo pega tal cual. */
  private async searchCondition(search: string): Promise<Prisma.SecurityAuditEventWhereInput> {
    /* Nombres y correos sin mayúsculas ni tildes. */
    const [userIds, clientIds] = await Promise.all([
      idsMatchingText(this.database, "AuthUser", ["username", "name"], search),
      idsMatchingText(this.database, "Client", ["name", "email"], search),
    ]);
    return {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: [...userIds, ...clientIds] } },
        ...(/^[0-9a-f-]{6,36}$/i.test(search) ? [{ requestId: { startsWith: search.toLowerCase() } }] : []),
      ],
    };
  }
}
