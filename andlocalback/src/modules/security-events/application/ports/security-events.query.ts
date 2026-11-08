import { SecurityAuditAction, SecurityAuditOutcome } from "../../../../common/audit/security-audit.port";

export const SECURITY_EVENTS_QUERY = Symbol("SECURITY_EVENTS_QUERY");

/* Los grupos que ofrece la pantalla. Cada accion pertenece a uno solo. */
export const SECURITY_EVENT_CATEGORIES = ["access", "credentials", "team", "clients", "receipts"] as const;
export type SecurityEventCategory = (typeof SECURITY_EVENT_CATEGORIES)[number];

export const actionsByCategory: Readonly<Record<SecurityEventCategory, readonly SecurityAuditAction[]>> = {
  access: ["LOGIN_SUCCEEDED", "LOGIN_FAILED", "ACCOUNT_LOCKED", "LOGOUT", "REFRESH_TOKEN_REUSED"],
  credentials: ["PASSWORD_CHANGED", "PASSWORD_CHANGE_FAILED", "MFA_ENABLED", "MFA_DISABLED", "MFA_DISABLE_FAILED", "MFA_VERIFY_FAILED", "MFA_RECOVERY_CODE_USED"],
  team: ["TEAM_MEMBER_CREATED", "TEAM_MEMBER_UPDATED", "TEAM_ROLE_CHANGED", "TEAM_MEMBER_DEACTIVATED", "TEAM_MEMBER_REACTIVATED", "TEAM_PASSWORD_RESET", "TEAM_MFA_RESET"],
  clients: ["CLIENT_CREATED", "CLIENT_UPDATED", "CLIENT_MANAGER_ASSIGNED", "CLIENT_PASSWORD_RESET", "CLIENT_DEACTIVATED"],
  receipts: ["RECEIPT_VIEWED", "RECEIPT_ACCESS_DENIED"],
};

export type SecurityEventFilters = Readonly<{
  actions?: readonly SecurityAuditAction[];
  /* Solo fallidos y denegados: lo que se revisa primero. */
  problemsOnly?: boolean;
  search?: string;
  page: number;
  pageSize: number;
}>;

export type SecurityEventView = Readonly<{
  id: string;
  occurredAt: string;
  action: string;
  outcome: SecurityAuditOutcome;
  actor: Readonly<{ id: string; label: string }> | null;
  target: Readonly<{ type: string; id: string; label: string }> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  detail: Readonly<Record<string, unknown>> | null;
}>;

export type SecurityEventPage = Readonly<{
  items: readonly SecurityEventView[];
  page: number;
  totalPages: number;
  total: number;
  /* Nombres de las personas que aparecen en el detalle (gestor anterior y
     nuevo, a quien paso la cartera): la pantalla no tiene que pedirlos. */
  people: Readonly<Record<string, string>>;
}>;

export interface SecurityEventsQuery {
  list(filters: SecurityEventFilters): Promise<SecurityEventPage>;
}
