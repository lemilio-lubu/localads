import {
  ChannelResult,
  CreatedNotification,
  NotificationChannel,
  NotificationPreferenceStorePort,
  PushSenderPort,
  PushSubscriptionStorePort,
  StoredPushSubscription,
} from "../ports/push.ports";
import { NotificationStorePort } from "../ports/notification.ports";

/**
 * Canal push: manda cada aviso recién creado a los dispositivos de su
 * destinatario, salvo que haya apagado ese tipo. Una suscripción que el
 * servicio push da por muerta (404/410) se borra; las demás quedan con su
 * último éxito. Sin claves VAPID no hace nada.
 */
export class DeliverPushNotifications implements NotificationChannel {
  constructor(
    private readonly sender: PushSenderPort,
    private readonly subscriptions: PushSubscriptionStorePort,
    private readonly preferences: NotificationPreferenceStorePort,
    private readonly notifications: NotificationStorePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async deliver(created: readonly CreatedNotification[]): Promise<ChannelResult> {
    if (!this.sender.publicKey || created.length === 0) return { sent: 0, failed: 0 };
    const userIds = [...new Set(created.map((item) => item.recipientUserId))];
    const [subscriptions, disabled] = await Promise.all([this.subscriptions.forUsers(userIds), this.preferences.disabledTypes(userIds)]);
    if (subscriptions.length === 0) return { sent: 0, failed: 0 };

    const byUser = new Map<string, StoredPushSubscription[]>();
    for (const subscription of subscriptions) byUser.set(subscription.userId, [...(byUser.get(subscription.userId) ?? []), subscription]);

    const gone = new Set<string>();
    const succeeded = new Set<string>();
    const pushed = new Set<string>();
    let failed = 0;
    await Promise.all(created.map(async (notification) => {
      if (disabled.get(notification.recipientUserId)?.has(notification.type)) return;
      const payload = { title: notification.title, body: notification.body, url: notification.linkPath, tag: notification.id };
      await Promise.all((byUser.get(notification.recipientUserId) ?? []).map(async (subscription) => {
        try {
          if ((await this.sender.send(subscription, payload)) === "gone") {
            gone.add(subscription.id);
            return;
          }
          succeeded.add(subscription.id);
          pushed.add(notification.id);
        } catch {
          failed++;
        }
      }));
    }));

    const at = this.now();
    await Promise.all([
      this.subscriptions.removeByIds([...gone]),
      this.subscriptions.markSucceeded([...succeeded].filter((id) => !gone.has(id)), at),
      this.notifications.markPushSent([...pushed], at),
    ]);
    return { sent: pushed.size, failed };
  }
}
