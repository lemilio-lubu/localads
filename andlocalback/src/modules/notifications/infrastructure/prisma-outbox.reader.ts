import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BusinessEvent } from "../../../common/events/business-events";
import { PrismaService } from "../../../database/prisma.service";
import { ClaimedOutboxEvent, OutboxReaderPort } from "../application/ports/notification.ports";

type ClaimedRow = { id: string; type: string; payload: Record<string, unknown>; attempts: number };

@Injectable()
export class PrismaOutboxReader implements OutboxReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  /* Una sola sentencia reserva y devuelve: SKIP LOCKED salta las filas que
     otro proceso está tomando en ese instante, y lockedUntil cubre al que
     murió con el lote a medias. */
  async claim(now: Date, lockUntil: Date, limit: number): Promise<readonly ClaimedOutboxEvent[]> {
    /* Prisma guarda las fechas en UTC en columnas sin zona horaria, y un Date
       en SQL crudo llega con zona: sin pasarlo a UTC, Postgres lo compararía
       en la zona de la sesión y los hechos parecerían estar en el futuro. */
    const nowUtc = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;
    const lockUtc = Prisma.sql`(${lockUntil}::timestamptz AT TIME ZONE 'UTC')`;
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "OutboxEvent"
      SET "lockedUntil" = ${lockUtc}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "OutboxEvent"
        WHERE "processedAt" IS NULL
          AND "availableAt" <= ${nowUtc}
          AND ("lockedUntil" IS NULL OR "lockedUntil" < ${nowUtc})
        ORDER BY "occurredAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
    return rows.map((row) => ({ id: row.id, attempts: row.attempts, event: { ...row.payload, type: row.type } as BusinessEvent }));
  }

  async markProcessed(id: string, at: Date): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id }, data: { processedAt: at, lockedUntil: null, lastError: null } });
  }

  async markFailed(id: string, error: string, retryAt: Date): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id }, data: { lastError: error.slice(0, 500), availableAt: retryAt, lockedUntil: null } });
  }
}
