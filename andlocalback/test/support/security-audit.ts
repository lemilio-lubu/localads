import { SecurityAuditEntry, SecurityAuditLog } from "../../src/common/audit/security-audit.port";

/* Doble del registro de seguridad: guarda los eventos para poder afirmar
   sobre ellos. */
export function recordingAudit(): SecurityAuditLog & { readonly events: SecurityAuditEntry[] } {
  const events: SecurityAuditEntry[] = [];
  return { events, async record(entry) { events.push(entry); } };
}
