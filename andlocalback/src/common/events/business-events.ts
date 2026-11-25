/* Hechos de negocio que otros módulos pueden escuchar (hoy, notificaciones).
   Cada uno se escribe en el outbox dentro de la misma transacción que el
   cambio que describe, así que si existe, el cambio ocurrió.

   Solo llevan ids y lo imprescindible: quien los consume resuelve el resto
   (cliente, gestor, nombres) al procesarlos, con datos frescos. Por eso son
   estables: añadir un dato a un aviso no obliga a cambiar quien escribe.

   actorUserId: quien provocó el cambio. Nadie recibe aviso de lo que acaba
   de hacer él mismo. */
export type BusinessEvent =
  | Readonly<{ type: "activation.requested"; requestId: string; clientId: string; platform: string }>
  | Readonly<{ type: "activation.approved"; requestId: string; clientId: string; platform: string; actorUserId: string | null }>
  | Readonly<{ type: "activation.rejected"; requestId: string; clientId: string; platform: string; reason: string; actorUserId: string | null }>
  | Readonly<{ type: "recharge.postpaid_requested"; transactionId: string }>
  /* El OCR terminó y el comprobante espera una decisión. ocrFailed: no se
     pudo leer y hay que revisarlo a mano. */
  | Readonly<{ type: "payment.review_required"; transactionId: string; verificationId: string; ocrFailed: boolean }>
  | Readonly<{ type: "payment.approved"; transactionId: string; verificationId: string; actorUserId: string | null }>
  | Readonly<{ type: "payment.rejected"; transactionId: string; verificationId: string; reason: string; actorUserId: string | null }>
  | Readonly<{ type: "recharge.completed"; transactionId: string }>
  | Readonly<{ type: "invoice.authorized"; invoiceId: string; transactionId: string }>
  /* Lleva varios intentos seguidos sin autorizarse: hace falta una persona. */
  | Readonly<{ type: "invoice.stuck"; invoiceId: string; transactionId: string; attempts: number }>
  | Readonly<{ type: "payment.overdue"; paymentId: string; transactionId: string }>
  /* Recordatorio de un pago pospago en crédito. daysLeft: días de calendario
     (hora de Ecuador) hasta el vencimiento; 0 es el mismo día. */
  | Readonly<{ type: "payment.due_soon"; paymentId: string; transactionId: string; daysLeft: number }>
  | Readonly<{ type: "client.manager_assigned"; clientId: string; managerId: string }>
  /* Seguridad de la cuenta: se avisa a su dueño, también si fue él (si no lo
     fue, es como se entera). No se pueden apagar. */
  | Readonly<{ type: "security.password_changed"; userId: string }>
  | Readonly<{ type: "security.mfa_enabled"; userId: string }>
  | Readonly<{ type: "security.mfa_disabled"; userId: string }>
  /* Se reutilizó un refresh ya renovado: se cerraron todas sus sesiones. */
  | Readonly<{ type: "security.sessions_revoked"; userId: string }>
  /* Salud del correo, para los admins. day: AAAA-MM-DD en hora de Ecuador. */
  | Readonly<{ type: "email.quota_warning"; day: string; sent: number; limit: number }>
  | Readonly<{ type: "email.delivery_failing"; day: string; failed: number }>;

export type BusinessEventType = BusinessEvent["type"];

/* A partir de cuántos fallos seguidos una factura se considera atascada. */
export const INVOICE_STUCK_AFTER_ATTEMPTS = 3;
