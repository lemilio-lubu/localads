import { planNotifications, subjectOf } from "../../domain/notification-catalog";
import { NotificationRealtimePort, NotificationStorePort, OutboxReaderPort, RecipientDirectoryPort } from "../ports/notification.ports";

const BATCH = 50;
/* Lo que dura la reserva: si el proceso muere a mitad, pasado este tiempo
   otro retoma el hecho. */
const LOCK_MS = 60_000;
const MAX_RETRY_MS = 30 * 60_000;

export type DispatchResult = Readonly<{ processed: number; failed: number; notified: number }>;

/**
 * Convierte los hechos pendientes del outbox en avisos de bandeja. Es seguro
 * reintentarlo: la reserva evita que dos procesos tomen el mismo hecho y el
 * dedupeKey evita duplicar un aviso si un hecho se procesa dos veces.
 *
 * Un hecho que falla no frena a los demás: espera con retroceso creciente y
 * se reintenta solo.
 */
export class DispatchBusinessEvents {
  constructor(
    private readonly outbox: OutboxReaderPort,
    private readonly directory: RecipientDirectoryPort,
    private readonly store: NotificationStorePort,
    private readonly realtime: NotificationRealtimePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<DispatchResult> {
    const at = this.now();
    const claimed = await this.outbox.claim(at, new Date(at.getTime() + LOCK_MS), BATCH);
    let processed = 0;
    let failed = 0;
    const touched = new Set<string>();
    for (const item of claimed) {
      try {
        const context = await this.directory.contextFor(subjectOf(item.event));
        /* Sin cliente no hay a quién avisar: el hecho queda procesado. */
        const planned = context ? planNotifications(item.event, context) : [];
        const created = await this.store.insert(item.event.type, `outbox:${item.id}`, planned);
        for (const userId of created) touched.add(userId);
        await this.outbox.markProcessed(item.id, this.now());
        processed++;
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : String(error);
        const waitMs = Math.min(MAX_RETRY_MS, 2 ** item.attempts * 30_000);
        await this.outbox.markFailed(item.id, reason, new Date(this.now().getTime() + waitMs)).catch(() => undefined);
      }
    }
    /* El contador en vivo es una mejora: si falla, la bandeja lo corrige al abrirse. */
    for (const userId of touched) {
      await this.store.countUnread(userId).then((unread) => this.realtime.notifyUser(userId, unread)).catch(() => undefined);
    }
    return { processed, failed, notified: touched.size };
  }
}
