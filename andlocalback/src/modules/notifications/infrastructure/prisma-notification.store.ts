import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { NotificationPage, NotificationStorePort, NotificationView } from "../application/ports/notification.ports";
import { CreatedNotification } from "../application/ports/push.ports";
import { PlannedNotification } from "../domain/notification-catalog";

const viewSelect = { id: true, type: true, title: true, body: true, linkPath: true, entityType: true, entityId: true, readAt: true, createdAt: true } as const;

@Injectable()
export class PrismaNotificationStore implements NotificationStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async insert(type: string, dedupeKey: string, notifications: readonly PlannedNotification[]): Promise<readonly CreatedNotification[]> {
    if (notifications.length === 0) return [];
    /* skipDuplicates + RETURNING: un reintento del mismo hecho no duplica y
       solo devuelve lo que de verdad se creó ahora. */
    const createdAt = new Date();
    return this.prisma.notification.createManyAndReturn({
      data: notifications.map((item) => ({ ...item, type, dedupeKey, createdAt })),
      skipDuplicates: true,
      select: { id: true, recipientUserId: true, type: true, title: true, body: true, linkPath: true },
    });
  }

  async list(userId: string, options: Readonly<{ cursor: string | null; limit: number; unreadOnly: boolean }>): Promise<NotificationPage> {
    const rows = await this.prisma.notification.findMany({
      where: { recipientUserId: userId, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      /* El cursor solo vale si es del mismo usuario: el where lo recorta. */
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: options.limit + 1,
      select: viewSelect,
    });
    const items = rows.slice(0, options.limit).map(toView);
    return { items, nextCursor: rows.length > options.limit ? items[items.length - 1]?.id ?? null : null };
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { recipientUserId: userId, readAt: null } });
  }

  async markRead(userId: string, ids: readonly string[] | "ALL", at: Date): Promise<number> {
    const updated = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, readAt: null, ...(ids === "ALL" ? {} : { id: { in: [...ids] } }) },
      data: { readAt: at },
    });
    return updated.count;
  }

  async markPushSent(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.notification.updateMany({ where: { id: { in: [...ids] } }, data: { pushSentAt: at } });
  }
}

function toView(row: { id: string; type: string; title: string; body: string; linkPath: string | null; entityType: string | null; entityId: string | null; readAt: Date | null; createdAt: Date }): NotificationView {
  return { ...row, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}
