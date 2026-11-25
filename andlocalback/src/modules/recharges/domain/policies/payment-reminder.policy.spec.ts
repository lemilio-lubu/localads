import { describe, expect, it } from "vitest";
import { daysUntilDue, reminderWindows } from "./payment-reminder.policy";

describe("recordatorios de vencimiento", () => {
  /* 22:00 del 24 en Ecuador (03:00 UTC del 25). */
  const now = new Date("2026-11-25T03:00:00.000Z");

  it("las ventanas siguen el día de Ecuador, no el de UTC", () => {
    const windows = reminderWindows(now);
    expect(windows.today).toEqual({ from: now, to: new Date("2026-11-25T05:00:00.000Z") });
    expect(windows.soon).toEqual({ from: new Date("2026-11-25T05:00:00.000Z"), to: new Date("2026-11-28T05:00:00.000Z") });
  });

  it("cuenta días de calendario hasta el vencimiento", () => {
    expect(daysUntilDue(new Date("2026-11-25T04:59:00.000Z"), now)).toBe(0);
    expect(daysUntilDue(new Date("2026-11-25T05:00:00.000Z"), now)).toBe(1);
    expect(daysUntilDue(new Date("2026-11-28T04:00:00.000Z"), now)).toBe(3);
  });
});
