/* Correo de avisos. Como el push, es una copia de cortesía de la bandeja. */

/* Adónde se manda el correo de un usuario: hoy, el correo de su empresa
   cliente (el mismo con el que entra al portal). */
export type EmailRecipient = Readonly<{ userId: string; role: "CLIENT" | "GESTOR" | "ADMIN"; email: string; name: string }>;

export interface EmailRecipientDirectoryPort {
  forUsers(userIds: readonly string[]): Promise<readonly EmailRecipient[]>;
}
export const EMAIL_RECIPIENT_DIRECTORY = Symbol("EMAIL_RECIPIENT_DIRECTORY");

export type EmailMessage = Readonly<{ to: Readonly<{ email: string; name: string }>; subject: string; text: string; html: string }>;

export interface EmailSenderPort {
  /* False sin clave o sin remitente configurado: el correo queda apagado. */
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}
export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

/* Un aviso por mandar por correo, nuevo (0 intentos) o en reintento. */
export type EmailCandidate = Readonly<{
  id: string; recipientUserId: string; type: string; title: string; body: string; linkPath: string | null; dedupeKey: string; emailAttempts: number;
}>;

/* El estado del correo de cada aviso vive en su fila de la bandeja. */
export interface EmailDeliveryStorePort {
  markSent(ids: readonly string[], at: Date): Promise<void>;
  /* Suma un intento fallido; retryAt null: no se reintenta más. */
  markFailed(ids: readonly string[], retryAt: Date | null): Promise<void>;
  /* Ya no toca mandarlo (apagó el correo, el usuario dejó de estar activo). */
  cancelRetry(ids: readonly string[]): Promise<void>;
  /* Reserva los reintentos vencidos con SKIP LOCKED, moviendo su próxima
     fecha a lockUntil: dos procesos nunca mandan el mismo. */
  claimRetries(now: Date, lockUntil: Date, limit: number): Promise<readonly EmailCandidate[]>;
}
export const EMAIL_DELIVERY_STORE = Symbol("EMAIL_DELIVERY_STORE");

export type EmailAlertEvent =
  | Readonly<{ type: "email.quota_warning"; day: string; sent: number; limit: number }>
  | Readonly<{ type: "email.delivery_failing"; day: string; failed: number }>;

/* Cuenta diaria de correos, para las alertas a los admins. */
export interface EmailUsagePort {
  /* Suma lo de este envío al día y devuelve el total del día. */
  record(day: string, sent: number, failed: number): Promise<Readonly<{ sent: number; failed: number }>>;
  /* Deja la alerta escrita en el outbox si ese día no se levantó ya; true
     si la levantó ahora. */
  raiseAlert(day: string, alert: "quota" | "failures", event: EmailAlertEvent): Promise<boolean>;
}
export const EMAIL_USAGE = Symbol("EMAIL_USAGE");
