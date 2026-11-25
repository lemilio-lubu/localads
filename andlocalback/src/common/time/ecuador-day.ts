/* Ecuador continental está en UTC-5 todo el año (sin horario de verano), así
   que el día local se calcula con un desfase fijo, sin depender de la zona
   horaria del servidor. */
const OFFSET_MS = 5 * 3_600_000;
export const DAY_MS = 86_400_000;

/* Inicio (en UTC) del día de Ecuador que contiene la fecha. */
export function ecuadorDayStart(date: Date): Date {
  return new Date(Math.floor((date.getTime() - OFFSET_MS) / DAY_MS) * DAY_MS + OFFSET_MS);
}

/* El día de Ecuador como AAAA-MM-DD. */
export function ecuadorDayKey(date: Date): string {
  return new Date(date.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}
