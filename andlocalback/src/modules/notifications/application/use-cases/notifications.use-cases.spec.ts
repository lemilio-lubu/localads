import { describe, expect, it, vi } from "vitest";
import { ClaimedOutboxEvent, NotificationStorePort } from "../ports/notification.ports";
import { RecipientContext } from "../../domain/notification-catalog";
import { DispatchBusinessEvents } from "./dispatch-business-events";
import { ListInbox, MarkInboxRead } from "./manage-inbox";

const now = new Date("2026-11-24T12:00:00.000Z");
const context: RecipientContext = { clientName: "Migo", clientUsers: [{ userId: "user-client", accountType: "PREPAGO" }], managerId: "user-gestor", adminIds: ["user-admin"] };

function store(overrides: Partial<NotificationStorePort> = {}) {
  return {
    insert: vi.fn(async (_type: string, _key: string, items: readonly { recipientUserId: string }[]) => items.map((item) => item.recipientUserId)),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    countUnread: vi.fn(async () => 2),
    markRead: vi.fn(async () => 1),
    ...overrides,
  };
}

function outbox(claimed: ClaimedOutboxEvent[]) {
  return { claim: vi.fn(async () => claimed), markProcessed: vi.fn(async () => undefined), markFailed: vi.fn(async () => undefined) };
}

describe("despacho de hechos del outbox", () => {
  it("crea los avisos con un dedupeKey por hecho, marca procesado y avisa en vivo", async () => {
    const reader = outbox([{ id: "evt-1", attempts: 1, event: { type: "recharge.completed", transactionId: "tx-1" } }]);
    const inbox = store();
    const realtime = { notifyUser: vi.fn() };
    const result = await new DispatchBusinessEvents(reader, { contextFor: async () => context }, inbox, realtime, () => now).execute();

    expect(result).toEqual({ processed: 1, failed: 0, notified: 1 });
    expect(inbox.insert).toHaveBeenCalledWith("recharge.completed", "outbox:evt-1", [expect.objectContaining({ recipientUserId: "user-client" })]);
    expect(reader.markProcessed).toHaveBeenCalledWith("evt-1", now);
    expect(realtime.notifyUser).toHaveBeenCalledWith("user-client", 2);
  });

  it("si el cliente ya no existe, da el hecho por procesado sin avisar", async () => {
    const reader = outbox([{ id: "evt-1", attempts: 1, event: { type: "recharge.completed", transactionId: "tx-borrada" } }]);
    const realtime = { notifyUser: vi.fn() };
    await new DispatchBusinessEvents(reader, { contextFor: async () => null }, store(), realtime, () => now).execute();
    expect(reader.markProcessed).toHaveBeenCalledWith("evt-1", now);
    expect(realtime.notifyUser).not.toHaveBeenCalled();
  });

  it("un hecho que falla espera con retroceso y no frena a los demás", async () => {
    const reader = outbox([
      { id: "evt-malo", attempts: 2, event: { type: "recharge.completed", transactionId: "tx-1" } },
      { id: "evt-bueno", attempts: 1, event: { type: "recharge.completed", transactionId: "tx-2" } },
    ]);
    const directory = { contextFor: vi.fn().mockRejectedValueOnce(new Error("base caída")).mockResolvedValue(context) };
    const result = await new DispatchBusinessEvents(reader, directory, store(), { notifyUser: vi.fn() }, () => now).execute();

    expect(result).toMatchObject({ processed: 1, failed: 1 });
    // Segundo intento: 2^2 × 30 s = 2 min.
    expect(reader.markFailed).toHaveBeenCalledWith("evt-malo", "base caída", new Date(now.getTime() + 120_000));
    expect(reader.markProcessed).toHaveBeenCalledWith("evt-bueno", now);
  });

  it("un reintento que no crea avisos nuevos no molesta a nadie en vivo", async () => {
    const reader = outbox([{ id: "evt-1", attempts: 2, event: { type: "recharge.completed", transactionId: "tx-1" } }]);
    const realtime = { notifyUser: vi.fn() };
    await new DispatchBusinessEvents(reader, { contextFor: async () => context }, store({ insert: vi.fn(async () => []) }), realtime, () => now).execute();
    expect(realtime.notifyUser).not.toHaveBeenCalled();
  });

  it("si el contador en vivo falla, el despacho sigue siendo correcto", async () => {
    const reader = outbox([{ id: "evt-1", attempts: 1, event: { type: "recharge.completed", transactionId: "tx-1" } }]);
    const inbox = store({ countUnread: vi.fn(async () => { throw new Error("caída"); }) });
    await expect(new DispatchBusinessEvents(reader, { contextFor: async () => context }, inbox, { notifyUser: vi.fn() }, () => now).execute()).resolves.toMatchObject({ processed: 1 });
  });
});

describe("bandeja", () => {
  it("lista solo la del usuario, con su contador y un límite acotado", async () => {
    const inbox = store();
    const result = await new ListInbox(inbox).execute({ userId: "user-1", limit: 500 });
    expect(inbox.list).toHaveBeenCalledWith("user-1", { cursor: null, limit: 50, unreadOnly: false });
    expect(result).toEqual({ items: [], nextCursor: null, unread: 2 });
  });

  it("marcar leídos devuelve el contador y avisa a las otras pestañas", async () => {
    const inbox = store();
    const realtime = { notifyUser: vi.fn() };
    expect(await new MarkInboxRead(inbox, realtime, () => now).execute({ userId: "user-1", ids: "ALL" })).toEqual({ unread: 2 });
    expect(inbox.markRead).toHaveBeenCalledWith("user-1", "ALL", now);
    expect(realtime.notifyUser).toHaveBeenCalledWith("user-1", 2);
  });

  it("si no cambió nada, no avisa", async () => {
    const realtime = { notifyUser: vi.fn() };
    await new MarkInboxRead(store({ markRead: vi.fn(async () => 0) }), realtime, () => now).execute({ userId: "user-1", ids: ["n-1"] });
    expect(realtime.notifyUser).not.toHaveBeenCalled();
  });

  it("rechaza una lista vacía o demasiado larga", async () => {
    const mark = new MarkInboxRead(store(), { notifyUser: vi.fn() }, () => now);
    await expect(mark.execute({ userId: "user-1", ids: [] })).rejects.toMatchObject({ code: "NOTIFICATION_IDS_INVALID" });
    await expect(mark.execute({ userId: "user-1", ids: Array.from({ length: 101 }, (_, i) => `n-${i}`) })).rejects.toMatchObject({ code: "NOTIFICATION_IDS_INVALID" });
  });
});
