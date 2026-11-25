import { describe, expect, it } from "vitest";
import { planNotifications, RecipientContext, subjectOf } from "./notification-catalog";

const withManager: RecipientContext = {
  clientName: "Migo Prepago",
  clientUsers: [{ userId: "user-client", accountType: "PREPAGO" }],
  managerId: "user-gestor",
  adminIds: ["user-admin-1", "user-admin-2"],
};
const orphan: RecipientContext = { ...withManager, managerId: null };
const recipients = (items: ReturnType<typeof planNotifications>) => items.map((item) => item.recipientUserId);

describe("catálogo de avisos por rol", () => {
  it("lo que exige actuar al equipo va al gestor del cliente, no a los admins", () => {
    const planned = planNotifications({ type: "payment.review_required", transactionId: "tx-1", verificationId: "v-1", ocrFailed: false }, withManager);
    expect(recipients(planned)).toEqual(["user-gestor"]);
    expect(planned[0]).toMatchObject({ linkPath: "/admin/verificaciones", entityType: "verification", entityId: "v-1" });
  });

  it("si el cliente no tiene gestor, el aviso va a todos los admins", () => {
    const planned = planNotifications({ type: "activation.requested", requestId: "r-1", clientId: "c-1", platform: "META" }, orphan);
    expect(recipients(planned)).toEqual(["user-admin-1", "user-admin-2"]);
    expect(planned[0]?.body).toBe("Migo Prepago pidió activar Meta.");
  });

  it("el cliente recibe sus avisos con el enlace de su tipo de cuenta", () => {
    const flex: RecipientContext = { ...withManager, clientUsers: [{ userId: "user-flex", accountType: "POSTPAGO" }] };
    expect(planNotifications({ type: "invoice.authorized", invoiceId: "i-1", transactionId: "tx-1" }, withManager)[0]?.linkPath).toBe("/prepago/facturas");
    expect(planNotifications({ type: "invoice.authorized", invoiceId: "i-1", transactionId: "tx-1" }, flex)[0]?.linkPath).toBe("/flex/facturas");
  });

  it("quien decide no recibe aviso de su propia decisión", () => {
    const planned = planNotifications({ type: "payment.approved", transactionId: "tx-1", verificationId: "v-1", actorUserId: "user-gestor" }, withManager);
    expect(recipients(planned)).toEqual(["user-client"]);
  });

  it("si el admin aprueba un pago de la cartera de un gestor, el gestor se entera", () => {
    const planned = planNotifications({ type: "payment.approved", transactionId: "tx-1", verificationId: "v-1", actorUserId: "user-admin-1" }, withManager);
    expect(recipients(planned)).toEqual(["user-client", "user-gestor"]);
  });

  it("una factura atascada es del sistema: solo admins, aunque el cliente tenga gestor", () => {
    const planned = planNotifications({ type: "invoice.stuck", invoiceId: "i-1", transactionId: "tx-1", attempts: 3 }, withManager);
    expect(recipients(planned)).toEqual(["user-admin-1", "user-admin-2"]);
  });

  it("un pago vencido avisa al cliente y a su responsable", () => {
    const planned = planNotifications({ type: "payment.overdue", paymentId: "p-1", transactionId: "tx-1" }, withManager);
    expect(recipients(planned)).toEqual(["user-client", "user-gestor"]);
  });

  it("el rechazo muestra el motivo al cliente y nada al equipo", () => {
    const planned = planNotifications({ type: "payment.rejected", transactionId: "tx-1", verificationId: "v-1", reason: "El monto no coincide", actorUserId: "user-gestor" }, withManager);
    expect(planned).toEqual([expect.objectContaining({ recipientUserId: "user-client", title: "Tu pago fue rechazado", body: "El monto no coincide" })]);
  });

  it("la asignación avisa solo al gestor nuevo", () => {
    const planned = planNotifications({ type: "client.manager_assigned", clientId: "c-1", managerId: "user-gestor-2" }, withManager);
    expect(recipients(planned)).toEqual(["user-gestor-2"]);
  });

  it("un hecho desconocido no avisa a nadie", () => {
    expect(planNotifications({ type: "algo.nuevo" } as never, withManager)).toEqual([]);
  });

  it("encuentra el cliente por su id o por la transacción", () => {
    expect(subjectOf({ type: "client.manager_assigned", clientId: "c-1", managerId: "g" })).toEqual({ clientId: "c-1" });
    expect(subjectOf({ type: "recharge.completed", transactionId: "tx-1" })).toEqual({ transactionId: "tx-1" });
  });
});
