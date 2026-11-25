/* Entrega de avisos fuera de la bandeja. La bandeja es la fuente de verdad;
   un canal (push hoy, correo en la fase 3) es una copia de cortesía: si
   falla, el aviso sigue en la campana. */

export type CreatedNotification = Readonly<{ id: string; recipientUserId: string; type: string; title: string; body: string; linkPath: string | null; dedupeKey: string }>;

export type ChannelResult = Readonly<{ sent: number; failed: number }>;

export interface NotificationChannel {
  deliver(notifications: readonly CreatedNotification[]): Promise<ChannelResult>;
}
export const NOTIFICATION_CHANNELS = Symbol("NOTIFICATION_CHANNELS");

export type StoredPushSubscription = Readonly<{ id: string; userId: string; endpoint: string; p256dh: string; auth: string }>;
export type NewPushSubscription = Readonly<{ userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }>;

export interface PushSubscriptionStorePort {
  /* Por endpoint: el dispositivo pasa a ser del usuario que lo activa. */
  upsert(subscription: NewPushSubscription): Promise<void>;
  /* Solo la del propio usuario. */
  remove(userId: string, endpoint: string): Promise<void>;
  forUsers(userIds: readonly string[]): Promise<readonly StoredPushSubscription[]>;
  removeByIds(ids: readonly string[]): Promise<void>;
  markSucceeded(ids: readonly string[], at: Date): Promise<void>;
}
export const PUSH_SUBSCRIPTION_STORE = Symbol("PUSH_SUBSCRIPTION_STORE");

/* Tipos que un usuario apagó, por canal. */
export type DisabledChannels = Readonly<{ push: ReadonlySet<string>; email: ReadonlySet<string> }>;

export interface NotificationPreferenceStorePort {
  /* Sin entrada para un usuario: todo encendido. */
  disabledTypes(userIds: readonly string[]): Promise<ReadonlyMap<string, DisabledChannels>>;
  setEnabled(userId: string, types: readonly string[], channel: "push" | "email", enabled: boolean): Promise<void>;
}
export const NOTIFICATION_PREFERENCE_STORE = Symbol("NOTIFICATION_PREFERENCE_STORE");

export type PushPayload = Readonly<{ title: string; body: string; url: string | null; tag: string }>;

/* "gone": el servicio push dice que esa suscripción ya no existe (404/410). */
export type PushSendOutcome = "sent" | "gone";

export interface PushSenderPort {
  /* Null si el servidor no tiene claves VAPID: el push queda apagado. */
  readonly publicKey: string | null;
  send(subscription: StoredPushSubscription, payload: PushPayload): Promise<PushSendOutcome>;
}
export const PUSH_SENDER = Symbol("PUSH_SENDER");
