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
