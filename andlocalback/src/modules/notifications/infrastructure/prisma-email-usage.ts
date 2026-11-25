import { Injectable } from "@nestjs/common";
import { appendBusinessEvents } from "../../../common/events/outbox";
import { PrismaService } from "../../../database/prisma.service";
import { EmailAlertEvent, EmailUsagePort } from "../application/ports/email.ports";

@Injectable()
export class PrismaEmailUsage implements EmailUsagePort {
  constructor(private readonly prisma: PrismaService) {}

  /* Insertar o sumar en una sola sentencia: dos procesos que mandan a la vez
     no se pisan la cuenta. */
  async record(day: string, sent: number, failed: number) {
    const [row] = await this.prisma.$queryRaw<{ sent: number; failed: number }[]>`
      INSERT INTO "EmailDailyUsage" ("day", "sent", "failed") VALUES (${day}, ${sent}, ${failed})
      ON CONFLICT ("day") DO UPDATE SET "sent" = "EmailDailyUsage"."sent" + EXCLUDED."sent", "failed" = "EmailDailyUsage"."failed" + EXCLUDED."failed"
      RETURNING "sent", "failed"
    `;
    return { sent: row?.sent ?? sent, failed: row?.failed ?? failed };
  }

  /* La marca y el hecho van juntos: si la alerta se levanta, el aviso sale. */
  raiseAlert(day: string, alert: "quota" | "failures", event: EmailAlertEvent): Promise<boolean> {
    const field = alert === "quota" ? "quotaAlertedAt" : "failuresAlertedAt";
    return this.prisma.$transaction(async (database) => {
      const claimed = await database.emailDailyUsage.updateMany({ where: { day, [field]: null }, data: { [field]: new Date() } });
      if (claimed.count === 0) return false;
      await appendBusinessEvents(database, event);
      return true;
    });
  }
}
