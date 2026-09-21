/* El color de un estado depende del dominio, no de la palabra. «Aprobada» en
   una verificación es un final: el pago quedó confirmado. «Aprobada» en una
   recarga no: el dinero todavía no llegó a la plataforma, falta ejecutarla.
   Pintarlas del mismo verde hacía creer que la recarga estaba hecha.

   La escala es una progresión, no un semáforo suelto:
     gris   — todavía no pasa nada (solicitada, en revisión)
     ámbar  — en marcha, falta un paso (aprobada, en proceso)
     verde  — terminado (completada, pagado)
     rojo   — se detuvo (rechazada, vencido)

   Vive en un solo sitio porque estaba copiado en tres pantallas y las tres
   habían divergido. */
export type StatusTone = "success" | "warning" | "danger" | "neutral";

const inList = (value: string | null | undefined, values: readonly string[]) => Boolean(value) && values.includes(value as string);

/* El backend devuelve el enum en inglés y, en registros antiguos, su
   traducción al español: ambas formas tienen que colorear igual. */
const rechargeDone = ["COMPLETED", "COMPLETADA"] as const;
const rechargeInFlight = ["APPROVED", "APROBADA", "PROCESSING", "EN_PROCESO"] as const;
const rechargeStopped = ["REJECTED", "RECHAZADA"] as const;

export function rechargeStatusTone(value: string | null | undefined): StatusTone {
  if (inList(value, rechargeDone)) return "success";
  if (inList(value, rechargeInFlight)) return "warning";
  if (inList(value, rechargeStopped)) return "danger";
  return "neutral";
}

/* «En crédito» no es un pago hecho: es una deuda viva con fecha. Verde decía
   que estaba saldada. */
export function paymentStatusTone(value: string | null | undefined): StatusTone {
  if (inList(value, ["PAID", "PAGADO"])) return "success";
  if (inList(value, ["IN_CREDIT", "EN_CREDITO"])) return "warning";
  if (inList(value, ["REJECTED", "RECHAZADO", "OVERDUE", "VENCIDO"])) return "danger";
  return "neutral";
}

/* Aquí «aprobada» sí es un final: la verificación quedó resuelta. */
export function verificationStatusTone(value: string | null | undefined): StatusTone {
  if (inList(value, ["APROBADA", "APPROVED", "VERIFICADA_AUTOMATICAMENTE"])) return "success";
  if (inList(value, ["RECHAZADA", "REJECTED"])) return "danger";
  return "neutral";
}

/* Y aquí también: aprobar una solicitud deja la pauta activa, no pendiente. */
export function activationStatusTone(value: string | null | undefined): StatusTone {
  if (inList(value, ["APPROVED", "APROBADA"])) return "success";
  if (inList(value, ["REJECTED", "RECHAZADA"])) return "danger";
  return "neutral";
}

export function invoiceStatusTone(value: string | null | undefined): StatusTone {
  return inList(value, ["ISSUED", "EMITIDA"]) ? "success" : "neutral";
}
