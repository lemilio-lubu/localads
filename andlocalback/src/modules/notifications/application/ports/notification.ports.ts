import { BusinessEvent } from "../../../../common/events/business-events";
import { EventSubject, PlannedNotification, RecipientContext } from "../../domain/notification-catalog";

export type ClaimedOutboxEvent = Readonly<{ id: string; attempts: number; event: BusinessEvent }>;

/* Lectura del outbox. claim reserva un lote con SKIP LOCKED: dos procesos
   del backend nunca toman el mismo hecho. */
export interface OutboxReaderPort {
  claim(now: Date, lockUntil: Date, limit: number): Promise<readonly ClaimedOutboxEvent[]>;
  markProcessed(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, retryAt: Date): Promise<void>;
}
export const OUTBOX_READER = Symbol("OUTBOX_READER");

/* Destinatarios posibles de un hecho, resueltos en el momento de despachar:
   si el cliente cambió de gestor entre medias, avisa al actual. Null si el
   cliente ya no existe. */
export interface RecipientDirectoryPort {
  contextFor(subject: EventSubject): Promise<RecipientContext | null>;
}
export const RECIPIENT_DIRECTORY = Symbol("RECIPIENT_DIRECTORY");

export type NotificationView = Readonly<{
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}>;

export type NotificationPage = Readonly<{ items: readonly NotificationView[]; nextCursor: string | null }>;

export interface NotificationStorePort {
  /* Inserta sin duplicar (dedupeKey) y devuelve a quién se le creó algo nuevo. */
  insert(type: string, dedupeKey: string, notifications: readonly PlannedNotification[]): Promise<readonly string[]>;
  list(userId: string, options: Readonly<{ cursor: string | null; limit: number; unreadOnly: boolean }>): Promise<NotificationPage>;
  countUnread(userId: string): Promise<number>;
  /* Solo marca las del propio usuario: devuelve cuántas cambió. */
  markRead(userId: string, ids: readonly string[] | "ALL", at: Date): Promise<number>;
}
export const NOTIFICATION_STORE = Symbol("NOTIFICATION_STORE");

/* Aviso a las pestañas abiertas del usuario. No lleva el contenido: la
   bandeja lo pide con sus permisos. Publicar nunca falla. */
export interface NotificationRealtimePort {
  notifyUser(userId: string, unread: number): void;
}
export const NOTIFICATION_REALTIME = Symbol("NOTIFICATION_REALTIME");
