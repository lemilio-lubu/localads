/**
 * Formato de presentación compartido por las listas de transacciones del
 * portal de cliente y del de admin. Vivían duplicados: el vencimiento se
 * redactaba solo en «tus facturas», así que el mismo dato se leía distinto —
 * o no se leía — según quién mirara la misma transacción.
 */

const moneyFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const dateTimeFormat = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const percentFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const dayFormat = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
const clockFormat = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });

export const formatAmount = (value: number) => moneyFormat.format(value);
export const formatDateTime = (value: string) => dateTimeFormat.format(new Date(value));
export const formatDay = (value: string) => dayFormat.format(new Date(value));
/** Hora de la ultima carga, para la meta de lista. Estaba declarada identica
    en cuatro pantallas: facturas, transacciones, verificaciones y activaciones. */
export const formatClock = (value: Date) => clockFormat.format(value);
/** Tasas en fraccion (0.05) a porcentaje legible. Estaba escrito dos veces, con
    dos redondeos distintos, en recargar y en el detalle de transacciones. */
export const formatPercent = (rate: number) => `${percentFormat.format(rate * 100)}%`;

/** Días entre hoy y el vencimiento, por día natural, para que «vence hoy» sea hoy. */
export function daysUntil(value: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(value); end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** El backend da la fecha; el texto en días es cálculo de presentación, no de negocio. */
export function dueLabel(dueDate: string) {
  const days = daysUntil(dueDate);
  if (days > 1) return `vence en ${days} días · ${formatDay(dueDate)}`;
  if (days === 1) return `vence mañana · ${formatDay(dueDate)}`;
  if (days === 0) return `vence hoy · ${formatDay(dueDate)}`;
  const overdue = Math.abs(days);
  return `venció hace ${overdue} ${overdue === 1 ? "día" : "días"} · ${formatDay(dueDate)}`;
}

/** El guion de «sin dato». Los dos modales de detalle lo escribian a mano junto
    a su propio formateador, que era el motivo de que existieran esas copias. */
export const NO_DATA = "—";
export const formatAmountOr = (value: number | null | undefined) => (value == null ? NO_DATA : formatAmount(value));
export const formatDateTimeOr = (value: string | null | undefined) => (value ? formatDateTime(value) : NO_DATA);
