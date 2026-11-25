import { ecuadorDayKey } from "../../../../common/time/ecuador-day";
import { EmailAlert, emailAlertsDue, nextEmailRetryAt } from "../../domain/email-health";
import { sendsEmail } from "../../domain/notification-preferences";
import { EmailAlertEvent, EmailCandidate, EmailDeliveryStorePort, EmailRecipientDirectoryPort, EmailSenderPort, EmailUsagePort } from "../ports/email.ports";
import { ChannelResult, CreatedNotification, NotificationChannel, NotificationPreferenceStorePort } from "../ports/push.ports";
import { renderNotificationEmail } from "../services/notification-email.template";

const RETRY_BATCH = 50;
/* Lo que dura la reserva de un reintento: si el proceso muere a mitad,
   pasado este tiempo otro lo retoma. */
const RETRY_LOCK_MS = 10 * 60_000;

export type EmailChannelConfig = Readonly<{
  /* Origen público del frontend para el enlace; sin él, el correo va sin enlace. */
  appUrl: string | null;
  dailyLimit: number;
}>;

type Message = { notification: EmailCandidate; email: string; name: string; ids: string[]; attempts: number };

/**
 * Canal de correo: de lo recién creado, manda por correo solo los tipos que
 * lo tienen para el rol del destinatario (lo crítico del cliente), salvo que
 * lo haya apagado. Varios usuarios de un mismo cliente comparten su correo:
 * ese correo recibe un solo mensaje por hecho. Sin proveedor configurado no
 * hace nada.
 *
 * Un envío que falla queda programado para reintentarse (retryPending) y
 * cuenta para el día; al acercarse al límite diario o acumular fallos se
 * avisa a los admins, una vez por día.
 */
export class DeliverEmailNotifications implements NotificationChannel {
  constructor(
    private readonly sender: EmailSenderPort,
    private readonly directory: EmailRecipientDirectoryPort,
    private readonly preferences: NotificationPreferenceStorePort,
    private readonly deliveries: EmailDeliveryStorePort,
    private readonly usage: EmailUsagePort,
    private readonly config: EmailChannelConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  deliver(created: readonly CreatedNotification[]): Promise<ChannelResult> {
    return this.send(created.map((notification) => ({ ...notification, emailAttempts: 0 })));
  }

  /* Reintenta los correos que fallaron y ya cumplieron su espera. */
  async retryPending(): Promise<ChannelResult> {
    if (!this.sender.enabled) return { sent: 0, failed: 0 };
    const at = this.now();
    const pending = await this.deliveries.claimRetries(at, new Date(at.getTime() + RETRY_LOCK_MS), RETRY_BATCH);
    return this.send(pending);
  }

  private async send(candidates: readonly EmailCandidate[]): Promise<ChannelResult> {
    if (!this.sender.enabled || candidates.length === 0) return { sent: 0, failed: 0 };
    const userIds = [...new Set(candidates.map((item) => item.recipientUserId))];
    const recipients = new Map((await this.directory.forUsers(userIds)).map((recipient) => [recipient.userId, recipient]));
    const emailable = candidates.filter((item) => {
      const recipient = recipients.get(item.recipientUserId);
      return recipient !== undefined && sendsEmail(recipient.role, item.type);
    });
    const disabled = emailable.length > 0 ? await this.preferences.disabledTypes([...new Set(emailable.map((item) => item.recipientUserId))]) : new Map();

    /* Un mensaje por correo y hecho; el aviso de cada usuario que comparte
       ese correo queda marcado como enviado. */
    const messages = new Map<string, Message>();
    const queued = new Set<string>();
    for (const notification of emailable) {
      if (disabled.get(notification.recipientUserId)?.email.has(notification.type)) continue;
      const recipient = recipients.get(notification.recipientUserId)!;
      const key = `${recipient.email.toLowerCase()}|${notification.dedupeKey}`;
      queued.add(notification.id);
      const existing = messages.get(key);
      if (existing) {
        existing.ids.push(notification.id);
        existing.attempts = Math.max(existing.attempts, notification.emailAttempts);
      } else messages.set(key, { notification, email: recipient.email, name: recipient.name, ids: [notification.id], attempts: notification.emailAttempts });
    }
    /* Un reintento que ya no toca (apagó el correo, ya no está activo) sale de la cola. */
    const dropped = candidates.filter((item) => item.emailAttempts > 0 && !queued.has(item.id)).map((item) => item.id);
    if (dropped.length > 0) await this.deliveries.cancelRetry(dropped);
    if (messages.size === 0) return { sent: 0, failed: 0 };

    const at = this.now();
    const sentIds: string[] = [];
    const failures: Message[] = [];
    await Promise.all([...messages.values()].map(async (message) => {
      const { notification, email, name, ids } = message;
      const url = this.config.appUrl && notification.linkPath ? new URL(notification.linkPath, this.config.appUrl).toString() : null;
      try {
        await this.sender.send({ to: { email, name }, ...renderNotificationEmail({ title: notification.title, body: notification.body, url }) });
        sentIds.push(...ids);
      } catch {
        failures.push(message);
      }
    }));
    await Promise.all([
      this.deliveries.markSent(sentIds, at),
      ...failures.map((message) => this.deliveries.markFailed(message.ids, nextEmailRetryAt(message.attempts + 1, at))),
    ]);
    await this.checkHealth(at, messages.size - failures.length, failures.length);
    return { sent: messages.size - failures.length, failed: failures.length };
  }

  /* Las alertas son una ayuda: si fallan, el envío ya quedó registrado. */
  private async checkHealth(at: Date, sent: number, failed: number): Promise<void> {
    try {
      const day = ecuadorDayKey(at);
      const totals = await this.usage.record(day, sent, failed);
      for (const alert of emailAlertsDue(totals, this.config.dailyLimit)) {
        await this.usage.raiseAlert(day, alert, alertEvent(alert, day, totals, this.config.dailyLimit));
      }
    } catch {
      /* Sin cuenta de hoy no hay alerta, pero el correo ya salió o quedó en cola. */
    }
  }
}

function alertEvent(alert: EmailAlert, day: string, totals: Readonly<{ sent: number; failed: number }>, limit: number): EmailAlertEvent {
  return alert === "quota"
    ? { type: "email.quota_warning", day, sent: totals.sent, limit }
    : { type: "email.delivery_failing", day, failed: totals.failed };
}
