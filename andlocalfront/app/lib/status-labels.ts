type Labels = Readonly<Record<string, string>>;

function translate(value: string | null | undefined, labels: Labels, emptyLabel: string): string {
  if (!value) return emptyLabel;
  return labels[value] ?? "Estado desconocido";
}

const rechargeLabels: Labels = {
  REQUESTED: "Solicitada",
  UNDER_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  PROCESSING: "En proceso",
  COMPLETED: "Completada",
  REJECTED: "Rechazada",
  PENDIENTE_VERIFICACION: "Pendiente de verificación",
  APROBADA: "Aprobada",
  EN_PROCESO: "En proceso",
  RECHAZADA: "Rechazada",
};

const paymentLabels: Labels = {
  PENDING: "Pendiente",
  IN_CREDIT: "En crédito",
  UNDER_REVIEW: "En revisión",
  PAID: "Pagado",
  OVERDUE: "Vencido",
  REJECTED: "Rechazado",
  PENDIENTE: "Pendiente",
  EN_CREDITO: "En crédito",
  EN_REVISION: "En revisión",
  PAGADO: "Pagado",
  VENCIDO: "Vencido",
  RECHAZADO: "Rechazado",
};

const verificationLabels: Labels = {
  EN_REVISION: "En revisión",
  VERIFICADA_AUTOMATICAMENTE: "Verificada automáticamente",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
};

const invoiceLabels: Labels = { ISSUED: "Emitida", EMITIDA: "Emitida" };

const verificationIssueLabels: Labels = {
  MONTO_NO_COINCIDE: "El monto detectado no coincide",
  MONTO_NO_DETECTADO: "No se detectó el monto",
  BAJA_CONFIANZA: "La confianza del OCR es baja",
  FALLO_OCR: "No se pudo procesar el comprobante",
  BANCO_NO_IDENTIFICADO: "No se identificó el banco",
  REFERENCIA_BANCARIA_NO_IDENTIFICADA: "No se identificó la referencia bancaria",
  FECHA_FUERA_DE_RANGO: "La fecha está fuera del rango esperado",
  COMPROBANTE_DUPLICADO: "El comprobante ya fue utilizado",
  REFERENCIA_BANCARIA_DUPLICADA: "La referencia bancaria ya fue utilizada",
};

export const rechargeStatusLabel = (value: string | null | undefined) => translate(value, rechargeLabels, "Sin estado");
export const transactionDetailStatusLabel = rechargeStatusLabel;
export const paymentStatusLabel = (value: string | null | undefined) => translate(value, paymentLabels, "Sin pago");
export const verificationStatusLabel = (value: string | null | undefined) => translate(value, verificationLabels, "Sin verificación");
export const invoiceStatusLabel = (value: string | null | undefined) => translate(value, invoiceLabels, "Sin factura");
export const verificationIssueLabel = (value: string) => verificationIssueLabels[value] ?? "Requiere revisión manual";
