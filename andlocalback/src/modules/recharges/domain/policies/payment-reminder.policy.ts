import { DAY_MS, ecuadorDayStart } from "../../../../common/time/ecuador-day";

/* Recordatorios de un pago pospago en crédito (decidido en el plan de
   notificaciones): uno unos días antes y otro el mismo día del vencimiento,
   por día de calendario de Ecuador. Si el crédito es más corto que el
   aviso previo, el primero sale en cuanto entra en la ventana. */
export const DUE_SOON_DAYS = 3;

export type ReminderWindows = Readonly<{
  /* Vence hoy y todavía no venció. */
  today: Readonly<{ from: Date; to: Date }>;
  /* Vence entre mañana y dentro de DUE_SOON_DAYS días. */
  soon: Readonly<{ from: Date; to: Date }>;
}>;

export function reminderWindows(now: Date): ReminderWindows {
  const tomorrow = new Date(ecuadorDayStart(now).getTime() + DAY_MS);
  return {
    today: { from: now, to: tomorrow },
    soon: { from: tomorrow, to: new Date(tomorrow.getTime() + DUE_SOON_DAYS * DAY_MS) },
  };
}

/* Días de calendario de Ecuador entre hoy y el vencimiento. */
export function daysUntilDue(dueDate: Date, now: Date): number {
  return Math.round((ecuadorDayStart(dueDate).getTime() - ecuadorDayStart(now).getTime()) / DAY_MS);
}
