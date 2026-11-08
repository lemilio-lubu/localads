import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { serializeError } from "../observability/logger";
import { RequestContext } from "../observability/request-context";
import { SecurityAuditEntry, SecurityAuditLog } from "./security-audit.port";

@Injectable()
export class PrismaSecurityAuditLog implements SecurityAuditLog {
  private readonly logger = new Logger("SecurityAudit");

  constructor(private readonly database: PrismaService) {}

  async record(entry: SecurityAuditEntry): Promise<void> {
    const context = RequestContext.current();
    const row = {
      action: entry.action,
      outcome: entry.outcome,
      actorUserId: entry.actorUserId === undefined ? context?.userId ?? null : entry.actorUserId,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      requestId: context?.requestId ?? null,
    };
    /* Tambien al log: quien vigile los logs (alertas por picos de fallos de
       login) no necesita consultar la base. */
    this.logger.log({ msg: "evento de seguridad", audit: { ...row, detail: entry.detail ?? null } });
    try {
      await this.database.securityAuditEvent.create({ data: { ...row, ...(entry.detail ? { detail: entry.detail as Prisma.InputJsonObject } : {}) } });
    } catch (error) {
      this.logger.error({ msg: "No se pudo guardar el evento de seguridad", action: entry.action, error: serializeError(error) });
    }
  }
}
