/* Lo que el cliente necesita leer para entender en qué punto está su recarga.
   Aprobar no es acreditar: el saldo de cada plataforma y la factura llegan
   cuando el equipo la acredita, y sin esta explicación un postpago aprobado
   con saldo en cero parecía un error. */

const platformNames: Record<string, string> = { META: "Meta", GOOGLE: "Google", TIKTOK: "TikTok" };

export function platformList(platforms: readonly string[]): string {
  const names = [...new Set(platforms.map((platform) => platformNames[platform.toUpperCase()] ?? platform))];
  return new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(names);
}

export type ProgressStep = { label: string; reached: boolean };

/* El postpago nace aprobado; el prepago pasa antes por la verificación del pago. */
export function rechargeSteps(postpaid: boolean, rechargeStatus: string): ProgressStep[] | null {
  if (rechargeStatus === "REJECTED") return null;
  const labels = postpaid ? ["Aprobada", "Acreditando", "Completada"] : ["Pago en revisión", "Aprobada", "Acreditando", "Completada"];
  const reachedLabel: Record<string, string> = { REQUESTED: "Pago en revisión", UNDER_REVIEW: "Pago en revisión", APPROVED: "Aprobada", PROCESSING: "Acreditando", COMPLETED: "Completada" };
  const current = labels.indexOf(reachedLabel[rechargeStatus] ?? labels[0]);
  return labels.map((label, index) => ({ label, reached: index <= Math.max(current, 0) }));
}

export function rechargeMessage(rechargeStatus: string, platforms: string, hasInvoice: boolean): string {
  switch (rechargeStatus) {
    case "REQUESTED":
    case "UNDER_REVIEW": return `Estamos verificando tu pago. Al confirmarlo, aprobamos la recarga y la acreditamos en ${platforms}.`;
    case "APPROVED": return `Tu recarga está aprobada. La acreditaremos en ${platforms}; al terminar verás el saldo y tu factura.`;
    case "PROCESSING": return `Estamos acreditando tu recarga en ${platforms}. El saldo de cada plataforma sube en cuanto se acredita y la factura llega al completar todas.`;
    case "COMPLETED": return hasInvoice ? `Recarga acreditada en ${platforms}. Tu factura ya está disponible.` : `Recarga acreditada en ${platforms}.`;
    case "REJECTED": return "Esta recarga fue rechazada y no se acreditó en ninguna plataforma.";
    default: return "";
  }
}

/* La verificación es del pago, no de la recarga: el postpago ya puede estar
   acreditándose mientras se valida la transferencia. */
export function paymentVerificationMessage(verificationStatus: string, postpaid: boolean): string {
  switch (verificationStatus) {
    case "EN_REVISION": return `Recibimos tu transferencia y la estamos validando.${postpaid ? " Tu recarga sigue su curso." : ""}`;
    case "VERIFICADA_AUTOMATICAMENTE": return "Tu transferencia pasó la validación automática; falta la confirmación final del equipo.";
    case "APROBADA": return "Pago confirmado.";
    case "RECHAZADA": return "No pudimos validar tu transferencia. Sube un nuevo comprobante.";
    default: return "";
  }
}

/* Sin documento todavía. Si ya hay factura, está esperando la autorización
   fiscal del emisor (segundos, o hasta que vuelva si estaba caído). */
export function pendingInvoiceLabel(rechargeStatus: string, invoiceCreated: boolean): string {
  if (invoiceCreated) return "Autorizando factura";
  if (rechargeStatus === "REJECTED") return "No aplica";
  return "Llega al acreditar tu recarga";
}
