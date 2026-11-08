/**
 * Rango de días elegido en un filtro de fecha. Los dos extremos van en el
 * formato del `<input type="date">` (AAAA-MM-DD) o vacíos.
 */
export type DayRange = { from: string; to: string };

export const emptyDayRange: DayRange = { from: "", to: "" };

const pad = (value: number) => String(value).padStart(2, "0");

/** Un `Date` local como valor de `<input type="date">`. */
export function dayValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * El rango como lo pide la API: el inicio del primer día y el final del último,
 * en la hora del navegador. Con la medianoche UTC, «hoy» en Ecuador perdía las
 * cinco últimas horas del día.
 */
export function apiDayRange(range: DayRange): { from?: string; to?: string } {
  const result: { from?: string; to?: string } = {};
  if (range.from) result.from = localDay(range.from).toISOString();
  if (range.to) {
    const end = localDay(range.to);
    end.setHours(23, 59, 59, 999);
    result.to = end.toISOString();
  }
  return result;
}

export type DayPreset = { label: string; range: () => DayRange };

/** Los atajos que se piden casi siempre; el resto se elige a mano. */
export const dayPresets: readonly DayPreset[] = [
  { label: "hoy", range: () => { const today = dayValue(new Date()); return { from: today, to: today }; } },
  { label: "7 días", range: () => { const today = new Date(); const start = new Date(today); start.setDate(today.getDate() - 6); return { from: dayValue(start), to: dayValue(today) }; } },
  { label: "este mes", range: () => { const today = new Date(); return { from: dayValue(new Date(today.getFullYear(), today.getMonth(), 1)), to: dayValue(today) }; } },
  { label: "mes pasado", range: () => { const today = new Date(); return { from: dayValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: dayValue(new Date(today.getFullYear(), today.getMonth(), 0)) }; } },
];

const shortDay = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const shortDayWithYear = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });

function shortLabel(value: string) {
  const date = localDay(value);
  const format = date.getFullYear() === new Date().getFullYear() ? shortDay : shortDayWithYear;
  /* «1 de nov.» → «1 nov»: la pastilla tiene que caber en la barra. */
  return format.format(date).replace(/\./g, "").replace(/ de /g, " ");
}

/** Texto corto del rango para la pastilla: «1 – 8 nov», «desde 1 nov», «hasta 8 nov». */
export function dayRangeLabel(range: DayRange) {
  if (range.from && range.to) {
    if (range.from === range.to) return shortLabel(range.from);
    const from = localDay(range.from); const to = localDay(range.to);
    const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
    return sameMonth ? `${from.getDate()} – ${shortLabel(range.to)}` : `${shortLabel(range.from)} – ${shortLabel(range.to)}`;
  }
  if (range.from) return `desde ${shortLabel(range.from)}`;
  if (range.to) return `hasta ${shortLabel(range.to)}`;
  return "";
}
