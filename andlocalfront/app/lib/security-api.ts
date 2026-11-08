import { apiErrorMessage } from "./api-error";
import { authenticatedFetch } from "./auth-api";
import { formatDateTime } from "./format";

export type SecurityCategory = "access" | "credentials" | "team" | "clients" | "receipts";
export type SecurityOutcome = "SUCCESS" | "FAILURE" | "DENIED";

export type SecurityEvent = {
  id: string;
  occurredAt: string;
  action: string;
  outcome: SecurityOutcome;
  actor: { id: string; label: string } | null;
  target: { type: "USER" | "CLIENT" | "RECEIPT" | string; id: string; label: string } | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  detail: Record<string, unknown> | null;
};

export type SecurityEventPage = { items: SecurityEvent[]; page: number; totalPages: number; total: number; people: Record<string, string> };
export type SecurityFilters = { category: SecurityCategory | null; problemsOnly: boolean; search: string; page: number };

export async function getSecurityEvents(filters: SecurityFilters): Promise<SecurityEventPage> {
  const query = new URLSearchParams({ page: String(filters.page) });
  if (filters.category) query.set("category", filters.category);
  if (filters.problemsOnly) query.set("outcome", "problems");
  if (filters.search.trim()) query.set("search", filters.search.trim());
  const response = await authenticatedFetch(`/api/v1/admin/security-events?${query}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as SecurityEventPage | null;
  if (!response.ok) throw new Error(apiErrorMessage(response, payload, "No fue posible consultar el registro de seguridad"));
  return payload as SecurityEventPage;
}

/* Cada evento se lee como una frase: quién hizo qué, y debajo el porqué o
   el detalle. El backend guarda códigos; los textos viven aquí. */
const roles: Record<string, string> = { ADMIN: "administrador", GESTOR: "gestor", CLIENT: "cliente" };
const fields: Record<string, string> = {
  username: "correo", name: "nombre", email: "correo", ruc: "RUC", accountType: "tipo de cuenta", platforms: "plataformas",
  creditDays: "días de crédito", creditLimit: "cupo", status: "estado",
};
const loginReasons: Record<string, string> = {
  BAD_PASSWORD: "La contraseña era incorrecta.", LOCKED: "Su cuenta estaba bloqueada por demasiados intentos.",
  INACTIVE_USER: "Su usuario está dado de baja.", INACTIVE_CLIENT: "Su empresa está inactiva.",
};
const methods: Record<string, string> = { PASSWORD: "Con su contraseña.", TOTP: "Con su contraseña y el doble factor.", RECOVERY_CODE: "Con un código de recuperación." };
const text = (value: unknown) => (typeof value === "string" ? value : null);
const role = (value: unknown) => roles[text(value) ?? ""] ?? String(value);
const list = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;

export type EventSentence = { title: string; detail: string | null };

export function describeEvent(event: SecurityEvent, people: Record<string, string>): EventSentence {
  const detail = event.detail ?? {};
  const actor = event.actor?.label ?? "Alguien";
  const target = event.target?.label ?? "un registro eliminado";
  /* El dueño de la cuenta: quien actuó o, sin sesión (un login fallido), sobre quién. */
  const owner = event.actor?.label ?? event.target?.label ?? "Alguien";
  const person = (id: unknown) => (typeof id === "string" ? people[id] ?? "una cuenta eliminada" : null);
  const say = (title: string, line: string | null = null): EventSentence => ({ title, detail: line });
  switch (event.action) {
    case "LOGIN_SUCCEEDED": return say(`${owner} inició sesión`, methods[text(detail.method) ?? ""] ?? null);
    case "LOGIN_FAILED":
      return detail.reason === "UNKNOWN_USER"
        ? say("Alguien intentó entrar con un correo que no está registrado")
        : say(`${owner} no pudo iniciar sesión`, loginReasons[text(detail.reason) ?? ""] ?? null);
    case "ACCOUNT_LOCKED": return say(`Se bloqueó la cuenta de ${owner}`, text(detail.lockedUntil) ? `Tras ${detail.failedLoginCount} intentos fallidos. Podrá volver a intentarlo a partir del ${formatDateTime(detail.lockedUntil as string)}.` : null);
    case "LOGOUT": return say(`${owner} cerró sesión`);
    case "REFRESH_TOKEN_REUSED": return say(`Posible robo de la sesión de ${owner}`, "Alguien usó una sesión que ya no era válida. Por seguridad se cerraron todas sus sesiones.");
    case "PASSWORD_CHANGED": return say(`${owner} cambió su contraseña`, detail.wasTemporary === true ? "Reemplazó la contraseña temporal que se le entregó." : null);
    case "PASSWORD_CHANGE_FAILED": return say(`${owner} no pudo cambiar su contraseña`, "La contraseña actual era incorrecta.");
    case "MFA_ENABLED": return say(`${owner} activó el doble factor`);
    case "MFA_DISABLED": return say(`${owner} quitó el doble factor`);
    case "MFA_DISABLE_FAILED": return say(`${owner} no pudo quitar el doble factor`, detail.reason === "BAD_CODE" ? "El código era incorrecto." : "La contraseña era incorrecta.");
    case "MFA_VERIFY_FAILED": return say(`${owner} escribió mal el código del doble factor`, "Ocurrió al iniciar sesión.");
    case "MFA_RECOVERY_CODE_USED": return say(`${owner} usó un código de recuperación`, typeof detail.recoveryCodesLeft === "number" ? `Le quedan ${detail.recoveryCodesLeft}.` : null);
    case "TEAM_MEMBER_CREATED": return say(`${actor} añadió a ${target} al equipo`, detail.role ? `Con el rol de ${role(detail.role)}.` : null);
    case "TEAM_MEMBER_UPDATED": case "CLIENT_UPDATED": {
      const changed = Array.isArray(detail.fields) ? [...new Set(detail.fields.map((field) => fields[String(field)] ?? String(field)))] : [];
      const subject = event.action === "CLIENT_UPDATED" ? `los datos del cliente ${target}` : `la cuenta de ${target}`;
      return say(`${actor} editó ${subject}`, changed.length ? `Cambió: ${list(changed)}.` : null);
    }
    case "TEAM_ROLE_CHANGED": return say(`${actor} cambió el rol de ${target}`, `De ${role(detail.from)} a ${role(detail.to)}.`);
    case "TEAM_MEMBER_DEACTIVATED": {
      const moved = typeof detail.movedClients === "number" ? detail.movedClients : 0;
      const clients = `${moved} ${moved === 1 ? "cliente" : "clientes"}`;
      const line = !moved ? "No tenía clientes a su cargo." : detail.portfolioDestination === "reassign" ? `Sus ${clients} pasaron a ${person(detail.reassignedTo)}.` : `Sus ${clients} quedaron sin gestor.`;
      return say(`${actor} dio de baja a ${target}`, line);
    }
    case "TEAM_MEMBER_REACTIVATED": return say(`${actor} reactivó la cuenta de ${target}`);
    case "TEAM_PASSWORD_RESET": case "CLIENT_PASSWORD_RESET": return say(`${actor} restableció la contraseña de ${target}`, "Se generó una contraseña temporal.");
    case "TEAM_MFA_RESET": return say(`${actor} restableció el doble factor de ${target}`, "Tendrá que volver a activarlo si lo quiere.");
    case "CLIENT_CREATED": {
      const account = detail.accountType === "POSTPAGO" ? "Cuenta pospago" : detail.accountType === "PREPAGO" ? "Cuenta prepago" : "Cuenta";
      const manager = person(detail.managerId);
      return say(`${actor} dio de alta al cliente ${target}`, `${account}, ${manager ? `gestionada por ${manager}` : "sin gestor asignado"}.`);
    }
    case "CLIENT_MANAGER_ASSIGNED": return say(`${actor} cambió el gestor de ${target}`, `De ${person(detail.from) ?? "ninguno"} a ${person(detail.to) ?? "ninguno"}.`);
    case "CLIENT_DEACTIVATED": return say(`${actor} dio de baja al cliente ${target}`);
    case "RECEIPT_VIEWED": return say(`${actor} abrió el comprobante ${target}`);
    case "RECEIPT_ACCESS_DENIED": return say(`${actor} intentó abrir el comprobante ${target}`, "No tenía permiso, así que no se le mostró.");
    default: return say(`${owner}: ${event.action.toLowerCase().replaceAll("_", " ")}`);
  }
}

/* «Chrome en Mac» en vez de la cadena entera del navegador. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : null;
  const system = /iPhone|iPad/.test(userAgent) ? "iPhone o iPad" : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "Mac" : /Linux/.test(userAgent) ? "Linux" : null;
  if (!browser && !system) return null;
  return [browser, system].filter(Boolean).join(" en ");
}

/* La IP del propio servidor (::1, 127.0.0.1) solo aparece en pruebas locales. */
export const describeIp = (ip: string | null) => (!ip ? null : ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1" ? "este mismo equipo (local)" : ip);
