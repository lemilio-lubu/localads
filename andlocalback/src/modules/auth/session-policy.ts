import { AuthRole } from "./auth.types";

const minute = 60_000; const hour = 60 * minute; const day = 24 * hour;

/* Tres relojes (OWASP): el access token dura 15 minutos; la sesion se cierra
   por inactividad (sin renovar en `idleMs`) y, pase lo que pase, al llegar a
   `absoluteMs` desde el login. El equipo aprueba dinero: jornada de 12 h y
   media hora de inactividad. Los clientes, una semana y un dia. */
export function sessionLimits(role: AuthRole): Readonly<{ absoluteMs: number; idleMs: number }> {
  return role === "CLIENT" ? { absoluteMs: 7 * day, idleMs: day } : { absoluteMs: 12 * hour, idleMs: 30 * minute };
}

/* El token de refresh caduca en lo que llegue antes: la inactividad desde
   ahora o el tope absoluto de la familia. Asi una sola fecha en la base
   aplica los dos relojes. */
export function refreshExpiry(role: AuthRole, familyCreatedAt: Date, now = new Date()): Date {
  const { absoluteMs, idleMs } = sessionLimits(role);
  return new Date(Math.min(familyCreatedAt.getTime() + absoluteMs, now.getTime() + idleMs));
}

/* Dos renovaciones casi a la vez con el mismo token (recargar la pagina con
   una renovacion en vuelo) no son un robo: dentro de este margen la segunda
   recibe su propio token en vez de revocar toda la familia. */
export const refreshReuseGraceMs = 30_000;

/* Cinco fallos seguidos bloquean 15 minutos; cada fallo extra lo duplica,
   hasta un dia. */
export const lockoutThreshold = 5;
export function lockoutUntil(failedCount: number, now = new Date()): Date | null {
  if (failedCount < lockoutThreshold) return null;
  const minutes = Math.min(15 * 2 ** (failedCount - lockoutThreshold), 24 * 60);
  return new Date(now.getTime() + minutes * minute);
}

/* El doble factor es opcional para todos. Al equipo, que aprueba dinero, se
   le sugiere al entrar mientras no lo tenga; puede posponerlo. */
export const suggestsMfa = (role: AuthRole) => role === "ADMIN" || role === "GESTOR";
