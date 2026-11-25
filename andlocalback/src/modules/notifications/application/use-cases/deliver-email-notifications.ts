import { sendsEmail } from "../../domain/notification-preferences";
import { EmailRecipientDirectoryPort, EmailSenderPort } from "../ports/email.ports";
import { NotificationStorePort } from "../ports/notification.ports";
import { ChannelResult, CreatedNotification, NotificationChannel, NotificationPreferenceStorePort } from "../ports/push.ports";
import { renderNotificationEmail } from "../services/notification-email.template";

/**
 * Canal de correo: de lo recién creado, manda por correo solo los tipos que
 * lo tienen para el rol del destinatario (lo crítico del cliente), salvo que
 * lo haya apagado. Varios usuarios de un mismo cliente comparten su correo:
 * ese correo recibe un solo mensaje por hecho. Sin proveedor configurado no
 * hace nada.
 */
export class DeliverEmailNotifications implements NotificationChannel {
  constructor(
    private readonly sender: EmailSenderPort,
    private readonly directory: EmailRecipientDirectoryPort,
    private readonly preferences: NotificationPreferenceStorePort,
    private readonly notifications: NotificationStorePort,
    /* Origen público del frontend para el enlace; sin él, el correo va sin enlace. */
    private readonly appUrl: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async deliver(created: readonly CreatedNotification[]): Promise<ChannelResult> {
    if (!this.sender.enabled || created.length === 0) return { sent: 0, failed: 0 };
    const userIds = [...new Set(created.map((item) => item.recipientUserId))];
    const recipients = new Map((await this.directory.forUsers(userIds)).map((recipient) => [recipient.userId, recipient]));
    const candidates = created.filter((item) => {
      const recipient = recipients.get(item.recipientUserId);
      return recipient !== undefined && sendsEmail(recipient.role, item.type);
    });
    if (candidates.length === 0) return { sent: 0, failed: 0 };
    const disabled = await this.preferences.disabledTypes([...new Set(candidates.map((item) => item.recipientUserId))]);

    /* Un mensaje por correo y hecho; el aviso de cada usuario que comparte
       ese correo queda marcado como enviado. */
    const messages = new Map<string, { notification: CreatedNotification; email: string; name: string; ids: string[] }>();
    for (const notification of candidates) {
      if (disabled.get(notification.recipientUserId)?.email.has(notification.type)) continue;
      const recipient = recipients.get(notification.recipientUserId)!;
      const key = `${recipient.email.toLowerCase()}|${notification.dedupeKey}`;
      const existing = messages.get(key);
      if (existing) existing.ids.push(notification.id);
      else messages.set(key, { notification, email: recipient.email, name: recipient.name, ids: [notification.id] });
    }

    const sentIds: string[] = [];
    let sent = 0;
    let failed = 0;
    await Promise.all([...messages.values()].map(async ({ notification, email, name, ids }) => {
      const url = this.appUrl && notification.linkPath ? new URL(notification.linkPath, this.appUrl).toString() : null;
      try {
        await this.sender.send({ to: { email, name }, ...renderNotificationEmail({ title: notification.title, body: notification.body, url }) });
        sent++;
        sentIds.push(...ids);
      } catch {
        failed++;
      }
    }));
    await this.notifications.markEmailSent(sentIds, this.now());
    return { sent, failed };
  }
}
