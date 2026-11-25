/* Reintentos y alertas del correo (fase 4 del plan de notificaciones).

   Un correo que falla no se pierde: se reintenta con esperas crecientes que
   suman algo más de un día, para que uno frenado por el límite diario del
   proveedor salga cuando el límite se renueva. Tras el último intento se
   abandona; el aviso sigue en la campana. */
export const EMAIL_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/* Cuándo reintentar tras el fallo número `attempts` (1 es el primero), o null
   si ya no quedan intentos. */
export function nextEmailRetryAt(attempts: number, now: Date): Date | null {
  const delay = EMAIL_RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/* Límite diario del plan gratis de Brevo; con un plan mayor se sube por entorno. */
export const DEFAULT_EMAIL_DAILY_LIMIT = 300;
/* Se avisa a los admins al llegar al 80 % del límite: queda margen para
   subir de plan o esperar al día siguiente. */
export const QUOTA_WARNING_RATIO = 0.8;
/* Intentos fallidos en un día a partir de los cuales algo anda mal (clave
   revocada, dominio sin verificar, proveedor caído). */
export const FAILURES_ALERT_THRESHOLD = 10;

export type EmailAlert = "quota" | "failures";
export type EmailUsage = Readonly<{ sent: number; failed: number }>;

/* Alertas que tocan con lo enviado hoy. Cada una sale una vez al día: eso lo
   asegura quien las guarda. */
export function emailAlertsDue(usage: EmailUsage, dailyLimit: number): EmailAlert[] {
  const alerts: EmailAlert[] = [];
  if (usage.sent >= Math.ceil(dailyLimit * QUOTA_WARNING_RATIO)) alerts.push("quota");
  if (usage.failed >= FAILURES_ALERT_THRESHOLD) alerts.push("failures");
  return alerts;
}

export function emailDailyLimitFromEnvironment(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.NOTIFICATIONS_EMAIL_DAILY_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_EMAIL_DAILY_LIMIT;
}
