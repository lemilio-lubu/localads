import { NotificationStorePort } from "../ports/notification.ports";

/* Retención de la bandeja (plan de notificaciones): lo leído se guarda 90
   días y lo no leído 180. Pasado eso, el caso sigue en su pantalla. */
export const READ_RETENTION_DAYS = 90;
export const UNREAD_RETENTION_DAYS = 180;
const BATCH = 1_000;
/* Tope por pasada, para no ocupar la base de datos de un tirón; lo que quede
   sale en la siguiente. */
const MAX_BATCHES = 20;
const DAY_MS = 86_400_000;

export class PurgeOldNotifications {
  constructor(private readonly store: NotificationStorePort, private readonly now: () => Date = () => new Date()) {}

  async execute(): Promise<number> {
    const at = this.now().getTime();
    const readBefore = new Date(at - READ_RETENTION_DAYS * DAY_MS);
    const unreadBefore = new Date(at - UNREAD_RETENTION_DAYS * DAY_MS);
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const deleted = await this.store.purgeOld(readBefore, unreadBefore, BATCH);
      total += deleted;
      if (deleted < BATCH) break;
    }
    return total;
  }
}
