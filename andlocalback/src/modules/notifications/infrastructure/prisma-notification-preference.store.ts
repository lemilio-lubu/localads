import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { NotificationPreferenceStorePort } from "../application/ports/push.ports";

@Injectable()
export class PrismaNotificationPreferenceStore implements NotificationPreferenceStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async disabledTypes(userIds: readonly string[]): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const result = new Map<string, Set<string>>();
    if (userIds.length === 0) return result;
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: [...userIds] }, push: false },
      select: { userId: true, type: true },
    });
    for (const row of rows) result.set(row.userId, (result.get(row.userId) ?? new Set<string>()).add(row.type));
    return result;
  }

  /* Encender borra la elección (vuelve al valor por defecto, encendido);
     apagar la guarda. Así la tabla solo tiene lo que alguien apagó. */
  async setPush(userId: string, types: readonly string[], push: boolean): Promise<void> {
    if (push) {
      await this.prisma.notificationPreference.deleteMany({ where: { userId, type: { in: [...types] } } });
      return;
    }
    await this.prisma.$transaction(types.map((type) => this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, push: false },
      update: { push: false },
    })));
  }
}
