import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { EmailCandidate, EmailDeliveryStorePort } from "../application/ports/email.ports";

@Injectable()
export class PrismaEmailDeliveryStore implements EmailDeliveryStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async markSent(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.notification.updateMany({ where: { id: { in: [...ids] } }, data: { emailSentAt: at, emailRetryAt: null } });
  }

  async markFailed(ids: readonly string[], retryAt: Date | null): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.notification.updateMany({ where: { id: { in: [...ids] }, emailSentAt: null }, data: { emailAttempts: { increment: 1 }, emailRetryAt: retryAt } });
  }

  async cancelRetry(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.notification.updateMany({ where: { id: { in: [...ids] } }, data: { emailRetryAt: null } });
  }

  /* Como el outbox: una sentencia reserva y devuelve, y las fechas van a UTC
     porque las columnas no llevan zona horaria. */
  async claimRetries(now: Date, lockUntil: Date, limit: number): Promise<readonly EmailCandidate[]> {
    const nowUtc = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;
    const lockUtc = Prisma.sql`(${lockUntil}::timestamptz AT TIME ZONE 'UTC')`;
    return this.prisma.$queryRaw<EmailCandidate[]>`
      UPDATE "Notification"
      SET "emailRetryAt" = ${lockUtc}
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "emailRetryAt" <= ${nowUtc} AND "emailSentAt" IS NULL
        ORDER BY "emailRetryAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "recipientUserId", "type", "title", "body", "linkPath", "dedupeKey", "emailAttempts"
    `;
  }
}
