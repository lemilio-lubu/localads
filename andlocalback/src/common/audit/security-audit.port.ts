/* Puerto del registro de eventos de seguridad (ISO 27001 8.15 · SOC 2 CC7.2).
   Quien lo usa dice que paso; el adaptador completa IP, user-agent,
   requestId y, si no se indica, el actor, desde la peticion en curso.

   El detalle es para investigar, no para reconstruir datos: nunca lleva
   claves, tokens, codigos, el correo tecleado en un login fallido (a veces es
   la clave escrita en el campo equivocado) ni referencias bancarias. */
export const SECURITY_AUDIT_LOG = Symbol("SECURITY_AUDIT_LOG");

export type SecurityAuditAction =
  | "LOGIN_SUCCEEDED" | "LOGIN_FAILED" | "ACCOUNT_LOCKED" | "LOGOUT" | "REFRESH_TOKEN_REUSED"
  | "MFA_VERIFY_FAILED" | "MFA_RECOVERY_CODE_USED" | "MFA_ENABLED" | "MFA_DISABLED" | "MFA_DISABLE_FAILED"
  | "PASSWORD_CHANGED" | "PASSWORD_CHANGE_FAILED"
  | "TEAM_MEMBER_CREATED" | "TEAM_MEMBER_UPDATED" | "TEAM_ROLE_CHANGED" | "TEAM_MEMBER_DEACTIVATED" | "TEAM_MEMBER_REACTIVATED"
  | "TEAM_PASSWORD_RESET" | "TEAM_MFA_RESET"
  | "CLIENT_CREATED" | "CLIENT_UPDATED" | "CLIENT_MANAGER_ASSIGNED" | "CLIENT_PASSWORD_RESET" | "CLIENT_DEACTIVATED"
  | "RECEIPT_VIEWED" | "RECEIPT_ACCESS_DENIED";

export type SecurityAuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";
export type SecurityAuditTarget = Readonly<{ type: "USER" | "CLIENT" | "RECEIPT"; id: string }>;
export type SecurityAuditDetail = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;

export type SecurityAuditEntry = Readonly<{
  action: SecurityAuditAction;
  outcome: SecurityAuditOutcome;
  /* undefined: el usuario autenticado de la peticion. null: nadie (un login
     fallido). */
  actorUserId?: string | null;
  target?: SecurityAuditTarget;
  detail?: SecurityAuditDetail;
}>;

export interface SecurityAuditLog {
  /* Nunca lanza: si no se puede guardar, lo deja en el log del servidor y la
     operacion sigue. Que un login no dependa de poder escribir su rastro es
     una decision de disponibilidad; el log es la copia de respaldo. */
  record(entry: SecurityAuditEntry): Promise<void>;
}
