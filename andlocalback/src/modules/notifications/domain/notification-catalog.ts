import { BusinessEvent } from "../../../common/events/business-events";

/* Quién se entera de cada hecho y qué se le dice. Es lo único que hay que
   tocar para añadir o cambiar un aviso: quien escribe el hecho no sabe nada
   de esto.

   Reglas por rol (decididas el 2026-11-24):
   - Cliente: solo lo de su cuenta.
   - Gestor: lo de los clientes de su cartera.
   - Admin: lo de los clientes sin gestor y lo del sistema (facturas). Lo de
     la cartera de un gestor no le llega: ya lo ve en sus pantallas.
   - Nadie recibe aviso de lo que acaba de hacer él mismo.

   Los textos no llevan importes, RUC ni datos bancarios: el detalle se ve al
   abrir el aviso, ya autenticado. */

export type ClientUser = Readonly<{ userId: string; accountType: string | null }>;

/* Lo que el despachador resuelve antes de llamar al catálogo. */
export type RecipientContext = Readonly<{
  clientName: string;
  clientUsers: readonly ClientUser[];
  managerId: string | null;
  adminIds: readonly string[];
}>;

export type PlannedNotification = Readonly<{
  recipientUserId: string;
  title: string;
  body: string;
  linkPath: string | null;
  entityType: string;
  entityId: string;
}>;

const platformNames: Record<string, string> = { META: "Meta", GOOGLE: "Google", TIKTOK: "TikTok" };
const platformName = (platform: string) => platformNames[platform] ?? platform;

/* Las pantallas del cliente cuelgan de su tipo de cuenta. */
const clientBase = (user: ClientUser) => (user.accountType === "PREPAGO" ? "/prepago" : "/flex");

type Message = Readonly<{ title: string; body: string }>;

const unknownActivity = "avisa de inmediato a un administrador de AND.";

function dueSoonMessage(daysLeft: number): Message {
  if (daysLeft <= 0) return { title: "Tu pago vence hoy", body: "Págalo hoy para seguir recargando sin interrupciones." };
  return { title: daysLeft === 1 ? "Tu pago vence mañana" : `Tu pago vence en ${daysLeft} días`, body: "Págalo a tiempo para seguir recargando sin interrupciones." };
}

export function planNotifications(event: BusinessEvent, context: RecipientContext): PlannedNotification[] {
  const actor = "actorUserId" in event ? event.actorUserId : null;
  const toClient = (message: Message, path: string, entityType: string, entityId: string) =>
    context.clientUsers.map((user) => ({ recipientUserId: user.userId, ...message, linkPath: `${clientBase(user)}${path}`, entityType, entityId }));
  /* El responsable del cliente: su gestor o, si no tiene, los admins. */
  const toStaff = (message: Message, linkPath: string, entityType: string, entityId: string) =>
    (context.managerId ? [context.managerId] : context.adminIds).map((recipientUserId) => ({ recipientUserId, ...message, linkPath, entityType, entityId }));
  const toAdmins = (message: Message, linkPath: string | null, entityType: string, entityId: string) =>
    context.adminIds.map((recipientUserId) => ({ recipientUserId, ...message, linkPath, entityType, entityId }));

  /* Seguridad: lleva a la pantalla de contraseña y verificación en dos pasos. */
  const toOwner = (userId: string, message: Message): PlannedNotification[] =>
    [{ recipientUserId: userId, ...message, linkPath: "/cambiar-contrasena", entityType: "user", entityId: userId }];

  const planned = ((): PlannedNotification[] => {
    switch (event.type) {
      case "activation.requested":
        return toStaff({ title: "Nueva solicitud de activación", body: `${context.clientName} pidió activar ${platformName(event.platform)}.` }, "/admin/activaciones", "activation", event.requestId);
      case "activation.approved":
        return toClient({ title: `Tu cuenta de ${platformName(event.platform)} está activa`, body: "Ya puedes recargarla." }, "/activos", "activation", event.requestId);
      case "activation.rejected":
        return toClient({ title: `No pudimos activar ${platformName(event.platform)}`, body: event.reason }, "/activos", "activation", event.requestId);
      case "recharge.postpaid_requested":
        return toStaff({ title: "Nueva recarga pospago", body: `${context.clientName} solicitó una recarga. Está lista para ejecutar.` }, "/admin/transacciones", "transaction", event.transactionId);
      case "payment.review_required":
        return toStaff({
          title: "Comprobante por revisar",
          body: event.ocrFailed
            ? `No se pudo leer el comprobante de ${context.clientName}: hay que revisarlo a mano.`
            : `El comprobante de ${context.clientName} está listo para revisar.`,
        }, "/admin/verificaciones", "verification", event.verificationId);
      case "payment.approved":
        return [
          ...toClient({ title: "Tu pago fue aprobado", body: "Estamos procesando tu recarga." }, "/facturas", "transaction", event.transactionId),
          ...toStaff({ title: "Pago aprobado", body: `La recarga de ${context.clientName} está lista para ejecutar.` }, "/admin/transacciones", "transaction", event.transactionId),
        ];
      case "payment.rejected":
        return toClient({ title: "Tu pago fue rechazado", body: event.reason }, "/facturas", "transaction", event.transactionId);
      case "recharge.completed":
        return toClient({ title: "Tu recarga está lista", body: "El saldo ya está acreditado en tus cuentas." }, "/facturas", "transaction", event.transactionId);
      case "invoice.authorized":
        return toClient({ title: "Tu factura está lista", body: "Ya puedes descargarla." }, "/facturas", "invoice", event.invoiceId);
      case "invoice.stuck":
        return toAdmins({ title: "Factura sin emitir", body: `La factura de ${context.clientName} no se pudo autorizar tras ${event.attempts} intentos.` }, "/admin/transacciones", "invoice", event.invoiceId);
      case "payment.overdue":
        return [
          ...toClient({ title: "Tienes un pago vencido", body: "Regulariza tu pago para seguir recargando." }, "/facturas", "payment", event.paymentId),
          ...toStaff({ title: "Pago vencido", body: `${context.clientName} tiene un pago pospago vencido.` }, "/admin/transacciones", "payment", event.paymentId),
        ];
      case "payment.due_soon":
        return toClient(dueSoonMessage(event.daysLeft), "/facturas", "payment", event.paymentId);
      case "security.password_changed":
        return toOwner(event.userId, { title: "Tu contraseña cambió", body: `Si no fuiste tú, ${unknownActivity}` });
      case "security.mfa_enabled":
        return toOwner(event.userId, { title: "Activaste la verificación en dos pasos", body: `Ahora tu cuenta pide un código al entrar. Si no fuiste tú, cambia tu contraseña y ${unknownActivity}` });
      case "security.mfa_disabled":
        return toOwner(event.userId, { title: "Se quitó la verificación en dos pasos", body: `Tu cuenta ya no pide código al entrar. Si no fuiste tú, cambia tu contraseña y ${unknownActivity}` });
      case "security.sessions_revoked":
        return toOwner(event.userId, { title: "Cerramos tus sesiones por seguridad", body: "Vimos un uso raro de tu sesión y la cerramos en todos tus dispositivos. Vuelve a entrar y, si no reconoces la actividad, cambia tu contraseña." });
      case "email.quota_warning":
        return toAdmins({ title: "Los correos están cerca del límite diario", body: `Hoy salieron ${event.sent} de ${event.limit} correos. Los que no quepan se reintentarán más tarde.` }, null, "email", event.day);
      case "email.delivery_failing":
        return toAdmins({ title: "Los correos están fallando", body: `Hoy fallaron ${event.failed} envíos de correo. Se reintentan solos; si sigue, revisa la cuenta de Brevo.` }, null, "email", event.day);
      case "client.manager_assigned":
        return [{ recipientUserId: event.managerId, title: "Te asignaron un cliente", body: `${context.clientName} ahora está en tu cartera.`, linkPath: "/admin/clientes", entityType: "client", entityId: event.clientId }];
      /* Un hecho que esta versión no conoce (escrito por una más nueva durante
         un despliegue) se da por procesado sin avisar a nadie. */
      default:
        return [];
    }
  })();

  /* Un usuario recibe un solo aviso por hecho, y nunca el suyo. */
  const seen = new Set<string>();
  return planned.filter((item) => {
    if (item.recipientUserId === actor || seen.has(item.recipientUserId)) return false;
    seen.add(item.recipientUserId);
    return true;
  });
}

/* De quién es el hecho, o cómo encontrarlo: un cliente (directo o por su
   transacción), un usuario (seguridad de su cuenta) o el sistema (solo
   admins). */
export type EventSubject = Readonly<{ clientId: string } | { transactionId: string } | { userId: string } | { system: true }>;

export function subjectOf(event: BusinessEvent): EventSubject {
  if ("clientId" in event) return { clientId: event.clientId };
  if ("transactionId" in event) return { transactionId: event.transactionId };
  if ("userId" in event) return { userId: event.userId };
  return { system: true };
}
