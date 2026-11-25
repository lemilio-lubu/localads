import { describe, expect, it, vi } from "vitest";
import { PurgeOldNotifications } from "./purge-old-notifications";

describe("retención de la bandeja", () => {
  const now = new Date("2026-11-25T12:00:00.000Z");

  it("borra lo leído de hace más de 90 días y lo no leído de hace más de 180, por lotes", async () => {
    const results = [1_000, 1_000, 7];
    const store = { purgeOld: vi.fn(async () => results.shift() ?? 0) };
    expect(await new PurgeOldNotifications(store as never, () => now).execute()).toBe(2_007);
    expect(store.purgeOld).toHaveBeenCalledTimes(3);
    expect(store.purgeOld).toHaveBeenCalledWith(new Date("2026-08-27T12:00:00.000Z"), new Date("2026-05-29T12:00:00.000Z"), 1_000);
  });

  it("no ocupa la base de un tirón: para tras unos lotes y sigue en la próxima pasada", async () => {
    const store = { purgeOld: vi.fn(async () => 1_000) };
    expect(await new PurgeOldNotifications(store as never, () => now).execute()).toBe(20_000);
  });
});
