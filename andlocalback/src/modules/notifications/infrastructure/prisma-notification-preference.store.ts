import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { DisabledChannels, NotificationPreferenceStorePort } from "../application/ports/push.ports";

@Injectable()
export class PrismaNotificationPreferenceStore implements NotificationPreferenceStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async disabledTypes(userIds: readonly string[]): Promise<ReadonlyMap<string, DisabledChannels>> {
    const result = new Map<string, { push: Set<string>; email: Set<string> }>();
    if (userIds.length === 0) return result;
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: [...userIds] }, OR: [{ push: false }, { email: false }] },
      select: { userId: true, type: true, push: true, email: true },
    });
    for (const row of rows) {
      const entry = result.get(row.userId) ?? { push: new Set<string>(), email: new Set<string>() };
      if (!row.push) entry.push.add(row.type);
      if (!row.email) entry.email.add(row.type);
      result.set(row.userId, entry);
    }
    return result;
  }

  /* La tabla solo guarda lo apagado: al encender, una fila que queda con los
     dos canales encendidos se borra (vuelve al valor por defecto). */
  async setEnabled(userId: string, types: readonly string[], channel: "push" | "email", enabled: boolean): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      for (const type of types) {
        await database.notificationPreference.upsert({
          where: { userId_type: { userId, type } },
          create: { userId, type, [channel]: enabled },
          update: { [channel]: enabled },
        });
      }
      await database.notificationPreference.deleteMany({ where: { userId, type: { in: [...types] }, push: true, email: true } });
    });
  }
}
