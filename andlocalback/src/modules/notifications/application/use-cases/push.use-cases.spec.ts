import { describe, expect, it, vi } from "vitest";
import { BusinessEvent } from "../../../../common/events/business-events";
import { isAllowedPushEndpoint, preferenceGroupsFor } from "../../domain/notification-preferences";
import { NotificationStorePort } from "../ports/notification.ports";
import { CreatedNotification, NotificationPreferenceStorePort, PushSenderPort, PushSubscriptionStorePort, StoredPushSubscription } from "../ports/push.ports";
import { DeliverPushNotifications } from "./deliver-push-notifications";
import { GetNotificationPreferences, RegisterPushSubscription, RemovePushSubscription, UpdateNotificationPreference } from "./manage-push";

const now = new Date("2026-11-24T12:00:00.000Z");
const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

const notification = (overrides: Partial<CreatedNotification> = {}): CreatedNotification => ({
  id: "n-1", recipientUserId: "user-1", type: "payment.approved", title: "Tu pago fue aprobado", body: "Estamos procesando tu recarga.", linkPath: "/prepago/facturas", dedupeKey: "outbox:evt-1", ...overrides,
});
const subscription = (overrides: Partial<StoredPushSubscription> = {}): StoredPushSubscription => ({ id: "s-1", userId: "user-1", endpoint, p256dh: "key", auth: "auth", ...overrides });

function subscriptionStore(subscriptions: readonly StoredPushSubscription[] = []) {
  return {
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    forUsers: vi.fn(async () => subscriptions),
    removeByIds: vi.fn(async () => undefined),
    markSucceeded: vi.fn(async () => undefined),
  } satisfies PushSubscriptionStorePort;
}

function preferenceStore(push: Record<string, string[]> = {}, email: Record<string, string[]> = {}) {
  const users = new Set([...Object.keys(push), ...Object.keys(email)]);
  return {
    disabledTypes: vi.fn(async () => new Map([...users].map((userId) => [userId, { push: new Set(push[userId] ?? []), email: new Set(email[userId] ?? []) }]))),
    setEnabled: vi.fn(async () => undefined),
  } satisfies NotificationPreferenceStorePort;
}

function sender(send: PushSenderPort["send"] = async () => "sent", publicKey: string | null = "public-key") {
  return { publicKey, send: vi.fn(send) };
}

function notificationStore() {
  return {
    insert: vi.fn(async () => []),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    countUnread: vi.fn(async () => 0),
    markRead: vi.fn(async () => 0),
    markPushSent: vi.fn(async () => undefined),
    purgeOld: vi.fn(async () => 0),
  } satisfies NotificationStorePort;
}

describe("canal push", () => {
  it("manda cada aviso a todos los dispositivos de su destinatario con un texto mínimo", async () => {
    const push = sender();
    const subscriptions = subscriptionStore([subscription(), subscription({ id: "s-2", endpoint: `${endpoint}2` })]);
    const store = notificationStore();
    const result = await new DeliverPushNotifications(push, subscriptions, preferenceStore(), store, () => now).deliver([notification()]);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(push.send).toHaveBeenCalledTimes(2);
    expect(push.send).toHaveBeenCalledWith(subscription(), { title: "Tu pago fue aprobado", body: "Estamos procesando tu recarga.", url: "/prepago/facturas", tag: "n-1" });
    expect(subscriptions.markSucceeded).toHaveBeenCalledWith(["s-1", "s-2"], now);
    expect(store.markPushSent).toHaveBeenCalledWith(["n-1"], now);
  });

  it("no manda lo que el usuario apagó", async () => {
    const push = sender();
    const result = await new DeliverPushNotifications(push, subscriptionStore([subscription()]), preferenceStore({ "user-1": ["payment.approved"] }), notificationStore(), () => now)
      .deliver([notification()]);
    expect(push.send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("nunca manda a los dispositivos de otro usuario", async () => {
    const push = sender();
    await new DeliverPushNotifications(push, subscriptionStore([subscription({ userId: "user-2" })]), preferenceStore(), notificationStore(), () => now)
      .deliver([notification()]);
    expect(push.send).not.toHaveBeenCalled();
  });

  it("borra la suscripción que el servicio push da por muerta y cuenta los fallos", async () => {
    const push = sender(async (target) => {
      if (target.id === "s-muerta") return "gone";
      throw new Error("timeout");
    });
    const subscriptions = subscriptionStore([subscription({ id: "s-muerta" }), subscription({ id: "s-lenta", endpoint: `${endpoint}2` })]);
    const store = notificationStore();
    const result = await new DeliverPushNotifications(push, subscriptions, preferenceStore(), store, () => now).deliver([notification()]);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(subscriptions.removeByIds).toHaveBeenCalledWith(["s-muerta"]);
    expect(store.markPushSent).toHaveBeenCalledWith([], now);
  });

  it("sin claves VAPID no consulta nada", async () => {
    const subscriptions = subscriptionStore([subscription()]);
    const result = await new DeliverPushNotifications(sender(undefined, null), subscriptions, preferenceStore(), notificationStore(), () => now).deliver([notification()]);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(subscriptions.forUsers).not.toHaveBeenCalled();
  });
});

describe("preferencias", () => {
  it("muestra los grupos del rol: un canal está encendido si ninguno de sus tipos está apagado", async () => {
    const email = { enabled: true, send: vi.fn() };
    const result = await new GetNotificationPreferences(preferenceStore({ "user-1": ["payment.rejected"] }, { "user-1": ["invoice.authorized"] }), sender(), email)
      .execute({ userId: "user-1", role: "CLIENT" });
    expect(result).toMatchObject({ pushAvailable: true, publicKey: "public-key", emailAvailable: true });
    expect(result.groups.find((group) => group.key === "payments")).toEqual({ key: "payments", label: "Pago aprobado o rechazado", push: false, email: true });
    expect(result.groups.find((group) => group.key === "invoices")).toMatchObject({ push: true, email: false });
    // Recarga completada no tiene correo.
    expect(result.groups.find((group) => group.key === "recharges")?.email).toBeNull();
  });

  it("el equipo no tiene correo en ningún grupo", async () => {
    const result = await new GetNotificationPreferences(preferenceStore(), sender(), { enabled: true, send: vi.fn() }).execute({ userId: "user-1", role: "ADMIN" });
    expect(result.groups.every((group) => group.email === null)).toBe(true);
  });

  it("apagar el push de un grupo apaga todos sus tipos", async () => {
    const preferences = preferenceStore();
    await new UpdateNotificationPreference(preferences).execute({ userId: "user-1", role: "GESTOR", key: "to_execute", channel: "push", enabled: false });
    expect(preferences.setEnabled).toHaveBeenCalledWith("user-1", ["payment.approved", "recharge.postpaid_requested"], "push", false);
  });

  it("apagar el correo de un grupo solo toca sus tipos con correo", async () => {
    const preferences = preferenceStore();
    await new UpdateNotificationPreference(preferences).execute({ userId: "user-1", role: "CLIENT", key: "payments", channel: "email", enabled: false });
    expect(preferences.setEnabled).toHaveBeenCalledWith("user-1", ["payment.rejected"], "email", false);
  });

  it("rechaza un grupo que no es del rol o un correo que ese grupo no tiene", async () => {
    const preferences = preferenceStore();
    const update = new UpdateNotificationPreference(preferences);
    await expect(update.execute({ userId: "user-1", role: "GESTOR", key: "invoice_failures", channel: "push", enabled: false }))
      .rejects.toMatchObject({ code: "NOTIFICATION_PREFERENCE_UNKNOWN", status: 400 });
    await expect(update.execute({ userId: "user-1", role: "CLIENT", key: "recharges", channel: "email", enabled: false }))
      .rejects.toMatchObject({ code: "NOTIFICATION_PREFERENCE_UNKNOWN", status: 400 });
    expect(preferences.setEnabled).not.toHaveBeenCalled();
  });

  it("cada tipo que recibe un rol se puede apagar desde su pantalla", () => {
    // Si se añade un aviso al catálogo sin grupo, este test lo recuerda.
    const received: Record<"CLIENT" | "GESTOR" | "ADMIN", BusinessEvent["type"][]> = {
      CLIENT: ["activation.approved", "activation.rejected", "payment.approved", "payment.rejected", "recharge.completed", "invoice.authorized", "payment.overdue"],
      GESTOR: ["activation.requested", "recharge.postpaid_requested", "payment.review_required", "payment.approved", "payment.overdue", "client.manager_assigned"],
      ADMIN: ["activation.requested", "recharge.postpaid_requested", "payment.review_required", "payment.approved", "payment.overdue", "invoice.stuck"],
    };
    for (const role of ["CLIENT", "GESTOR", "ADMIN"] as const) {
      const covered = new Set(preferenceGroupsFor(role).flatMap((group) => group.types));
      expect(received[role].filter((type) => !covered.has(type))).toEqual([]);
    }
  });
});

describe("suscripciones push", () => {
  const command = { userId: "user-1", endpoint, p256dh: "key", auth: "auth", userAgent: "Mozilla/5.0" };

  it("registra el dispositivo del usuario del token", async () => {
    const subscriptions = subscriptionStore();
    await new RegisterPushSubscription(subscriptions, sender()).execute(command);
    expect(subscriptions.upsert).toHaveBeenCalledWith(command);
  });

  it("rechaza endpoints que no son de un servicio push conocido", async () => {
    const subscriptions = subscriptionStore();
    const register = new RegisterPushSubscription(subscriptions, sender());
    for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost:3001/x", "https://fcm.googleapis.com.evil.com/x", "no-es-url"]) {
      await expect(register.execute({ ...command, endpoint: bad })).rejects.toMatchObject({ code: "PUSH_ENDPOINT_INVALID" });
    }
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it("sin claves VAPID responde que no está disponible", async () => {
    await expect(new RegisterPushSubscription(subscriptionStore(), sender(undefined, null)).execute(command)).rejects.toMatchObject({ code: "PUSH_UNAVAILABLE", status: 409 });
  });

  it("dar de baja solo toca la suscripción del propio usuario", async () => {
    const subscriptions = subscriptionStore();
    await new RemovePushSubscription(subscriptions).execute({ userId: "user-1", endpoint });
    expect(subscriptions.remove).toHaveBeenCalledWith("user-1", endpoint);
  });

  it("acepta los servicios push de Chrome, Firefox, Safari y Edge", () => {
    for (const ok of [endpoint, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QF", "https://wns2-db5p.notify.windows.com/w/?token=x"]) {
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    }
  });
});
