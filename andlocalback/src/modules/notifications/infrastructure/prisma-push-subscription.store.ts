import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { NewPushSubscription, PushSubscriptionStorePort, StoredPushSubscription } from "../application/ports/push.ports";

@Injectable()
export class PrismaPushSubscriptionStore implements PushSubscriptionStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(subscription: NewPushSubscription): Promise<void> {
    const { endpoint, ...data } = subscription;
    await this.prisma.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
  }

  async remove(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  forUsers(userIds: readonly string[]): Promise<readonly StoredPushSubscription[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.prisma.pushSubscription.findMany({
      where: { userId: { in: [...userIds] } },
      select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
    });
  }

  async removeByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushSubscription.deleteMany({ where: { id: { in: [...ids] } } });
  }

  async markSucceeded(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushSubscription.updateMany({ where: { id: { in: [...ids] } }, data: { lastSuccessAt: at } });
  }
}
