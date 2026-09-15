import { describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/modules/auth/access-token.service";
import { PasswordService } from "../src/modules/auth/password.service";

const principal = { userId: "user-1", username: "cliente", role: "CLIENT" as const, clientId: "client-1", accountId: "account-1", accountType: "PREPAGO" };

describe("Fase 10 - autenticación", () => {
  it("genera un JWT HS256 verificable con identidad y rol", () => {
    const service = new AccessTokenService(); const signed = service.sign(principal); const decoded = service.verify(signed.token);
    expect(signed.token.split(".")).toHaveLength(3); expect(decoded).toMatchObject(principal); expect(decoded.type).toBe("access"); expect(decoded.exp - decoded.iat).toBe(900);
  });
  it("rechaza un JWT alterado", () => {
    const service = new AccessTokenService(); const signed = service.sign(principal); const parts = signed.token.split(".");
    expect(() => service.verify(`${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}aa`)).toThrow("INVALID_TOKEN");
  });
  it("usa scrypt con salt y comparación segura", async () => {
    const service = new PasswordService(); const first = await service.hash("secreto-123"); const second = await service.hash("secreto-123");
    expect(first).not.toBe(second); await expect(service.verify("secreto-123", first)).resolves.toBe(true); await expect(service.verify("incorrecto", first)).resolves.toBe(false);
  });
});
