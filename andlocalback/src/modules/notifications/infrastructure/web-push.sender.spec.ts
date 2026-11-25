import { describe, expect, it } from "vitest";
import { vapidFromEnvironment } from "./web-push.sender";

const keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };

describe("configuración VAPID", () => {
  it("sin claves, el push queda apagado", () => {
    expect(vapidFromEnvironment({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
  });

  it("usa el origen del frontend como contacto solo si es https", () => {
    expect(vapidFromEnvironment({ ...keys, FRONTEND_ORIGIN: "https://app.andlocal.ec" })?.subject).toBe("https://app.andlocal.ec");
    expect(vapidFromEnvironment({ ...keys, FRONTEND_ORIGIN: "http://localhost:3000" })?.subject).toMatch(/^mailto:/);
  });

  it("VAPID_SUBJECT manda sobre el origen", () => {
    expect(vapidFromEnvironment({ ...keys, VAPID_SUBJECT: "mailto:ops@and.ec", FRONTEND_ORIGIN: "https://app.andlocal.ec" })?.subject).toBe("mailto:ops@and.ec");
  });
});
