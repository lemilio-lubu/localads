import { ApplicationError } from "../../../../common/errors/application.error";
import { NotificationPage, NotificationRealtimePort, NotificationStorePort } from "../ports/notification.ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_IDS = 100;

export type ListInboxCommand = Readonly<{ userId: string; cursor?: string; limit?: number; unreadOnly?: boolean }>;
export type MarkReadCommand = Readonly<{ userId: string; ids: readonly string[] | "ALL" }>;

/* La bandeja del usuario del token. Ningún comando acepta otro userId: cada
   consulta y cada marca van recortadas por el destinatario. */
export class ListInbox {
  constructor(private readonly store: NotificationStorePort) {}

  async execute(command: ListInboxCommand): Promise<NotificationPage & Readonly<{ unread: number }>> {
    const limit = Math.min(Math.max(Math.trunc(command.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const [page, unread] = await Promise.all([
      this.store.list(command.userId, { cursor: command.cursor ?? null, limit, unreadOnly: command.unreadOnly ?? false }),
      this.store.countUnread(command.userId),
    ]);
    return { ...page, unread };
  }
}

export class MarkInboxRead {
  constructor(
    private readonly store: NotificationStorePort,
    private readonly realtime: NotificationRealtimePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: MarkReadCommand): Promise<Readonly<{ unread: number }>> {
    if (command.ids !== "ALL" && (command.ids.length === 0 || command.ids.length > MAX_IDS)) {
      throw new ApplicationError("NOTIFICATION_IDS_INVALID", `Indica entre 1 y ${MAX_IDS} avisos`, 400);
    }
    const changed = await this.store.markRead(command.userId, command.ids, this.now());
    const unread = await this.store.countUnread(command.userId);
    /* Las otras pestañas del mismo usuario ajustan su contador. */
    if (changed > 0) this.realtime.notifyUser(command.userId, unread);
    return { unread };
  }
}
