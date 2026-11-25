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
  | Readonly<{ type: "client.manager_assigned"; clientId: string; managerId: string }>;

export type BusinessEventType = BusinessEvent["type"];

/* A partir de cuántos fallos seguidos una factura se considera atascada. */
export const INVOICE_STUCK_AFTER_ATTEMPTS = 3;
