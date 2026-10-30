/* Tres roles. GESTOR comparte las pantallas del portal administrativo con
   ADMIN, pero solo alcanza a los clientes que tiene asignados; ese recorte se
   aplica en los casos de uso, nunca en el frontend. */
export const AUTH_ROLES = ["CLIENT", "GESTOR", "ADMIN"] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];
export const isAuthRole = (value: string): value is AuthRole => (AUTH_ROLES as readonly string[]).includes(value);
/* mustChangePassword viaja en el token para que el guard no consulte la base
   en cada peticion. Vive 15 minutos, lo que dura el access token: al cambiarla
   se revocan las sesiones y el siguiente token ya sale sin la bandera. */
export type AuthPrincipal = Readonly<{ userId: string; username: string; role: AuthRole; clientId: string | null; accountId: string | null; accountType: string | null; mustChangePassword?: boolean }>;
/* Lo que se devuelve al abrir o renovar la sesión: el principal más el nombre
   con el que se muestra a la persona. No viaja en el token (no es de seguridad
   y se desactualizaría si se edita el nombre); solo en la respuesta. */
export type SessionUser = AuthPrincipal & Readonly<{ displayName: string }>;
export type AccessPayload = AuthPrincipal & Readonly<{ type: "access"; iat: number; exp: number; iss: string; aud: string }>;
