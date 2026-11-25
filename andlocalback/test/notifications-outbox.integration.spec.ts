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

  it("solo se guarda lo apagado: encender vuelve al valor por defecto", async () => {
    const preferences = new PrismaNotificationPreferenceStore(prisma as PrismaService);
    await preferences.setPush("auth-gestor", ["payment.approved", "recharge.postpaid_requested"], false);
    await preferences.setPush("auth-gestor", ["payment.approved", "recharge.postpaid_requested"], false);
    expect([...((await preferences.disabledTypes(["auth-gestor", "auth-prepago"])).get("auth-gestor") ?? [])].sort()).toEqual(["payment.approved", "recharge.postpaid_requested"]);

    await preferences.setPush("auth-gestor", ["payment.approved"], true);
    const after = await preferences.disabledTypes(["auth-gestor"]);
    expect([...(after.get("auth-gestor") ?? [])]).toEqual(["recharge.postpaid_requested"]);
    expect(await prisma.notificationPreference.count()).toBe(1);
  });
});
