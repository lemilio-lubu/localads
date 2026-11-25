import { BusinessEvent } from "../../../common/events/business-events";

type Role = "CLIENT" | "GESTOR" | "ADMIN";
type EventType = BusinessEvent["type"];

/* Lo que el usuario puede apagar del push, agrupado como lo entiende cada rol.
   Se guarda por tipo de aviso (estable); el grupo es solo cómo se muestra.
   Un mismo tipo puede estar en grupos distintos según el rol (un pago
   aprobado es «tu pago» para el cliente y «lista para ejecutar» para el
   gestor): cada usuario tiene un solo rol, así que no chocan.

   Al añadir un aviso en el catálogo, añádelo aquí al grupo del rol que lo
   recibe; si no, llega por push sin poder apagarse. */
export type PreferenceGroup = Readonly<{ key: string; label: string; types: readonly EventType[] }>;

const staffCommon: readonly PreferenceGroup[] = [
  { key: "activations", label: "Solicitudes de activación", types: ["activation.requested"] },
  { key: "review", label: "Comprobantes por revisar", types: ["payment.review_required"] },
  { key: "to_execute", label: "Recargas listas para ejecutar", types: ["payment.approved", "recharge.postpaid_requested"] },
  { key: "overdue", label: "Pagos vencidos", types: ["payment.overdue"] },
];

const groupsByRole: Record<Role, readonly PreferenceGroup[]> = {
  CLIENT: [
    { key: "activations", label: "Activación de tus cuentas", types: ["activation.approved", "activation.rejected"] },
    { key: "payments", label: "Pago aprobado o rechazado", types: ["payment.approved", "payment.rejected"] },
    { key: "recharges", label: "Recarga completada", types: ["recharge.completed"] },
    { key: "invoices", label: "Factura lista", types: ["invoice.authorized"] },
    { key: "overdue", label: "Pago vencido", types: ["payment.overdue"] },
  ],
  GESTOR: [...staffCommon, { key: "portfolio", label: "Clientes asignados a tu cartera", types: ["client.manager_assigned"] }],
  ADMIN: [...staffCommon, { key: "invoice_failures", label: "Facturas sin emitir", types: ["invoice.stuck"] }],
};

export const preferenceGroupsFor = (role: Role): readonly PreferenceGroup[] => groupsByRole[role];

export type NotificationChannelName = "push" | "email";

/* Correo (decidido el 2026-11-25): solo lo crítico del cliente, lo que le
   pide hacer algo o le sirve de comprobante. El resto ya llega por campana y
   push, y el plan gratis de Brevo tiene 300 correos al día. */
const clientEmailTypes: ReadonlySet<string> = new Set<EventType>(["payment.rejected", "payment.overdue", "invoice.authorized"]);

export const sendsEmail = (role: Role, type: string): boolean => role === "CLIENT" && clientEmailTypes.has(type);

/* Tipos del grupo que salen por correo para ese rol (vacío: el grupo no tiene casilla de correo). */
export const emailTypesOf = (role: Role, group: PreferenceGroup): readonly EventType[] => group.types.filter((type) => sendsEmail(role, type));

/* Servicios push de los navegadores. El backend hace un POST al endpoint que
   manda el navegador: aceptar cualquier URL dejaría a un usuario apuntarlo a
   la red interna (SSRF). */
const pushHosts = ["fcm.googleapis.com", "android.googleapis.com", "web.push.apple.com"];
const pushHostSuffixes = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return pushHosts.includes(host) || pushHostSuffixes.some((suffix) => host.endsWith(suffix));
}
