import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendBusinessEvents } from "../src/common/events/outbox";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { DispatchBusinessEvents } from "../src/modules/notifications/application/use-cases/dispatch-business-events";
import { PrismaNotificationPreferenceStore } from "../src/modules/notifications/infrastructure/prisma-notification-preference.store";
import { PrismaNotificationStore } from "../src/modules/notifications/infrastructure/prisma-notification.store";
import { PrismaPushSubscriptionStore } from "../src/modules/notifications/infrastructure/prisma-push-subscription.store";
import { PrismaOutboxReader } from "../src/modules/notifications/infrastructure/prisma-outbox.reader";
import { PrismaRecipientDirectory } from "../src/modules/notifications/infrastructure/prisma-recipient.directory";
import { PrismaEmailDeliveryStore } from "../src/modules/notifications/infrastructure/prisma-email-delivery.store";
import { PrismaEmailUsage } from "../src/modules/notifications/infrastructure/prisma-email-usage";
import { createTestDatabase } from "./support/postgres-test-database";

/* PostgreSQL de verdad: la reserva con SKIP LOCKED, el ON CONFLICT de la
   bandeja y la atomicidad del outbox solo se comprueban contra la base real. */
describe("outbox y bandeja de avisos", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;
  let reader: PrismaOutboxReader;
  let store: PrismaNotificationStore;

  beforeAll(async () => {
    database = await createTestDatabase("notifications");
    prisma = new PrismaClient({ datasourceUrl: database.url });
    reader = new PrismaOutboxReader(prisma as PrismaService);
    store = new PrismaNotificationStore(prisma as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await database.drop();
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.pushSubscription.deleteMany();
    await prisma.notificationPreference.deleteMany();
    await prisma.emailDailyUsage.deleteMany();
  });

  it("si la transacción se revierte, el hecho tampoco queda", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await appendBusinessEvents(tx, { type: "recharge.completed", transactionId: "tx-revertida" });
      throw new Error("falla después de escribir");
    })).rejects.toThrow("falla después de escribir");
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it("reasignar un cliente escribe el hecho en la misma operación, y solo si cambia de gestor", async () => {
    const clients = new PrismaClientAdminRepository(prisma as PrismaService);
    await clients.assignManager("client-002", "auth-gestor");
    await clients.assignManager("client-002", "auth-gestor");
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "client.manager_assigned", payload: { clientId: "client-002", managerId: "auth-gestor" } });
    await clients.assignManager("client-002", null);
  });

  it("dos procesos a la vez nunca toman el mismo hecho", async () => {
    await prisma.$transaction(async (tx) => {
      await appendBusinessEvents(tx, ...Array.from({ length: 10 }, (_, index) => ({ type: "recharge.completed" as const, transactionId: `tx-${index}` })));
    });
    const now = new Date();
    const lock = new Date(now.getTime() + 60_000);
    const otherReader = new PrismaOutboxReader(new PrismaClient({ datasourceUrl: database.url }) as PrismaService);
    const [first, second] = await Promise.all([reader.claim(now, lock, 6), otherReader.claim(now, lock, 6)]);
    const ids = [...first, ...second].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
    expect(await reader.claim(now, lock, 6)).toEqual([]);
  });

  it("del hecho al aviso: lo recibe el gestor del cliente, una sola vez aunque se reintente", async () => {
    await prisma.$transaction((tx) => appendBusinessEvents(tx, { type: "activation.requested", requestId: "req-1", clientId: "client-001", platform: "META" }));
    const pushed: [string, number][] = [];
    const dispatch = new DispatchBusinessEvents(reader, new PrismaRecipientDirectory(prisma as PrismaService), store, { notifyUser: (userId, unread) => pushed.push([userId, unread]) });

    expect(await dispatch.execute()).toEqual({ processed: 1, failed: 0, notified: 1, deliveryFailed: 0 });
    const [notification] = await prisma.notification.findMany();
    expect(notification).toMatchObject({ recipientUserId: "auth-gestor", type: "activation.requested", linkPath: "/admin/activaciones" });
    expect(pushed).toEqual([["auth-gestor", 1]]);

    // Un segundo proceso que retomara el mismo hecho no duplica el aviso.
    const event = await prisma.outboxEvent.findFirstOrThrow();
    expect(await store.insert("activation.requested", `outbox:${event.id}`, [{ recipientUserId: "auth-gestor", title: "x", body: "y", linkPath: null, entityType: "activation", entityId: "req-1" }])).toEqual([]);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("cada usuario ve y marca solo su bandeja", async () => {
    const plan = (recipientUserId: string, entityId: string) => ({ recipientUserId, title: "Aviso", body: "Texto", linkPath: null, entityType: "transaction", entityId });
    await store.insert("recharge.completed", "outbox:a", [plan("auth-prepago", "tx-a"), plan("auth-admin", "tx-a")]);
    await store.insert("recharge.completed", "outbox:b", [plan("auth-prepago", "tx-b")]);

    const page = await store.list("auth-prepago", { cursor: null, limit: 1, unreadOnly: false });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await store.list("auth-prepago", { cursor: page.nextCursor, limit: 1, unreadOnly: false });
    expect(next.items.map((item) => item.entityId)).not.toContain(page.items[0]?.entityId);

    const adminItem = (await store.list("auth-admin", { cursor: null, limit: 10, unreadOnly: false })).items[0]!;
    // El cliente intenta marcar el aviso del admin: no cambia nada.
    expect(await store.markRead("auth-prepago", [adminItem.id], new Date())).toBe(0);
    expect(await store.countUnread("auth-admin")).toBe(1);
    expect(await store.markRead("auth-prepago", "ALL", new Date())).toBe(2);
    expect(await store.countUnread("auth-prepago")).toBe(0);
  });

  it("un dispositivo pasa al usuario que activa los avisos en él, y cada uno solo borra el suyo", async () => {
    const subscriptions = new PrismaPushSubscriptionStore(prisma as PrismaService);
    const device = { endpoint: "https://fcm.googleapis.com/fcm/send/compartido", p256dh: "k", auth: "a", userAgent: null };
    await subscriptions.upsert({ userId: "auth-prepago", ...device });
    await subscriptions.upsert({ userId: "auth-gestor", ...device });
    expect((await subscriptions.forUsers(["auth-prepago", "auth-gestor"])).map((item) => item.userId)).toEqual(["auth-gestor"]);

    await subscriptions.remove("auth-prepago", device.endpoint);
    expect(await prisma.pushSubscription.count()).toBe(1);
    await subscriptions.remove("auth-gestor", device.endpoint);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("solo se guarda lo apagado: con los dos canales encendidos, la fila desaparece", async () => {
    const preferences = new PrismaNotificationPreferenceStore(prisma as PrismaService);
    await preferences.setEnabled("auth-prepago", ["payment.rejected", "payment.approved"], "push", false);
    await preferences.setEnabled("auth-prepago", ["payment.rejected"], "email", false);
    const disabled = (await preferences.disabledTypes(["auth-prepago", "auth-gestor"])).get("auth-prepago");
    expect([...(disabled?.push ?? [])].sort()).toEqual(["payment.approved", "payment.rejected"]);
    expect([...(disabled?.email ?? [])]).toEqual(["payment.rejected"]);

    await preferences.setEnabled("auth-prepago", ["payment.approved", "payment.rejected"], "push", true);
    expect(await prisma.notificationPreference.count()).toBe(1);
    await preferences.setEnabled("auth-prepago", ["payment.rejected"], "email", true);
    expect(await prisma.notificationPreference.count()).toBe(0);
  });
  it("un correo fallido se reserva para reintentar una sola vez, aunque haya dos procesos", async () => {
    const deliveries = new PrismaEmailDeliveryStore(prisma as PrismaService);
    const created = await store.insert("payment.rejected", "outbox:correo", [{ recipientUserId: "auth-prepago", title: "Tu pago fue rechazado", body: "x", linkPath: null, entityType: "transaction", entityId: "tx-1" }]);
    const ids = created.map((item) => item.id);
    const now = new Date();
    await deliveries.markFailed(ids, new Date(now.getTime() - 1_000));
    const lock = new Date(now.getTime() + 600_000);
    const other = new PrismaEmailDeliveryStore(new PrismaClient({ datasourceUrl: database.url }) as PrismaService);
    const [first, second] = await Promise.all([deliveries.claimRetries(now, lock, 10), other.claimRetries(now, lock, 10)]);
    expect([...first, ...second]).toEqual([expect.objectContaining({ id: ids[0], recipientUserId: "auth-prepago", dedupeKey: "outbox:correo", emailAttempts: 1 })]);
    expect(await deliveries.claimRetries(now, lock, 10)).toEqual([]);

    await deliveries.markSent(ids, now);
    expect(await prisma.notification.findUnique({ where: { id: ids[0] } })).toMatchObject({ emailRetryAt: null, emailAttempts: 1 });
    await deliveries.markFailed(ids, now);
    expect((await prisma.notification.findUnique({ where: { id: ids[0] } }))?.emailAttempts).toBe(1);
  });

  it("la cuenta del día suma sin pisarse y cada alerta sale una vez al día", async () => {
    const usage = new PrismaEmailUsage(prisma as PrismaService);
    await Promise.all([usage.record("2026-11-25", 2, 0), usage.record("2026-11-25", 3, 1)]);
    expect(await usage.record("2026-11-25", 0, 0)).toEqual({ sent: 5, failed: 1 });
    const event = { type: "email.quota_warning" as const, day: "2026-11-25", sent: 5, limit: 6 };
    expect(await usage.raiseAlert("2026-11-25", "quota", event)).toBe(true);
    expect(await usage.raiseAlert("2026-11-25", "quota", event)).toBe(false);
    expect(await usage.raiseAlert("2026-11-25", "failures", { type: "email.delivery_failing", day: "2026-11-25", failed: 1 })).toBe(true);
    expect((await prisma.outboxEvent.findMany()).map((item) => item.type).sort()).toEqual(["email.delivery_failing", "email.quota_warning"]);
  });

  it("la alerta del correo llega a los admins y la de seguridad solo al dueño", async () => {
    const directory = new PrismaRecipientDirectory(prisma as PrismaService);
    expect((await directory.contextFor({ system: true }))?.adminIds).toContain("auth-admin");
    expect(await directory.contextFor({ userId: "auth-gestor" })).toEqual({ clientName: "", clientUsers: [], managerId: null, adminIds: [] });
    expect(await directory.contextFor({ userId: "no-existe" })).toBeNull();
  });

  it("borra lo leído pasados 90 días y lo no leído pasados 180", async () => {
    const day = 86_400_000;
    const now = Date.now();
    const rows = [
      { key: "leido-viejo", readAt: new Date(now - 91 * day), createdAt: new Date(now - 91 * day) },
      { key: "leido-reciente", readAt: new Date(now - day), createdAt: new Date(now - 89 * day) },
      { key: "sin-leer-viejo", readAt: null, createdAt: new Date(now - 181 * day) },
      { key: "sin-leer-medio", readAt: null, createdAt: new Date(now - 100 * day) },
    ];
    await prisma.notification.createMany({ data: rows.map((row) => ({ recipientUserId: "auth-prepago", type: "recharge.completed", title: "t", body: "b", dedupeKey: row.key, readAt: row.readAt, createdAt: row.createdAt })) });
    expect(await store.purgeOld(new Date(now - 90 * day), new Date(now - 180 * day), 100)).toBe(2);
    expect((await prisma.notification.findMany({ orderBy: { dedupeKey: "asc" } })).map((row) => row.dedupeKey)).toEqual(["leido-reciente", "sin-leer-medio"]);
  });
});
