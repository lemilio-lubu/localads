import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TemporaryPasswordGuard } from "../src/modules/auth/auth.guards";
import { AuthService } from "../src/modules/auth/auth.service";
import { CredentialsService } from "../src/modules/auth/credentials.service";
import { PasswordService } from "../src/modules/auth/password.service";
import { deriveUsername, generateTemporaryPassword } from "../src/modules/auth/temporary-password";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";

const view: AdminClientView = {
  id: "c1", name: "Cliente", email: "cliente@example.test", ruc: "1712345675001", manager: null, status: "ACTIVE", createdAt: "2026-09-20T00:00:00.000Z",
  account: { id: "a1", type: AccountType.PREPAID, status: "ACTIVE", creditDays: 0, platforms: [AdvertisingPlatform.META] },
  totalRecharged: 0,
};

function repository(overrides: Partial<ClientAdminRepository> = {}): ClientAdminRepository {
  return {
    create: vi.fn().mockResolvedValue(view),
    list: vi.fn().mockResolvedValue([view]),
    findById: vi.fn().mockResolvedValue(view),
    update: vi.fn().mockResolvedValue(view),
    deactivate: vi.fn().mockResolvedValue(view),
    assignManager: vi.fn().mockResolvedValue(view),
    findLoginUsername: vi.fn().mockResolvedValue("cliente"),
    resetPassword: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function context(user: unknown, metadata: Record<string, boolean> = {}) {
  return {
    getType: () => "http",
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

const reflector = (metadata: Record<string, boolean>) => ({ getAllAndOverride: vi.fn((key: string) => metadata[key] ?? false) });

describe("Fase 12 - clave temporal", () => {
  it("la clave no usa caracteres que se confunden al dictarla", () => {
    const values = Array.from({ length: 200 }, () => generateTemporaryPassword());
    expect(values.every((value) => value.length === 12)).toBe(true);
    expect(values.join("")).not.toMatch(/[0O1lI5S]/);
    // Dos llamadas seguidas no pueden coincidir: si coincidieran, la fuente
    // no seria aleatoria y una clave temporal seria adivinable.
    expect(new Set(values).size).toBe(values.length);
  });

  it("deriva el usuario del correo, sin acentos ni simbolos, y esquiva los ocupados", async () => {
    expect(await deriveUsername("Andrés.Pérez+ads@example.test", async () => false)).toBe("andresperezads");
    const ocupados = new Set(["ana", "ana2"]);
    expect(await deriveUsername("ana@example.test", async (candidate) => ocupados.has(candidate))).toBe("ana3");
  });

  it("devuelve null en vez de reventar el UNIQUE cuando no queda ninguno libre", async () => {
    expect(await deriveUsername("ana@example.test", async () => true, 3)).toBeNull();
  });

  it("un correo sin parte util sigue dando un usuario valido", async () => {
    expect(await deriveUsername("!!!@example.test", async () => false)).toBe("usuario");
  });

  it("crear un cliente devuelve la clave en claro una vez y persiste solo el hash", async () => {
    const clients = repository();
    const credentials = { prepare: vi.fn().mockResolvedValue({ username: "cliente", temporaryPassword: "Abcd2345Wxyz", passwordHash: "scrypt$s$h" }), issue: vi.fn() };
    const result = await new ManageClients(clients, credentials).create({
      name: "Cliente", email: "cliente@example.test", ruc: "1712345675001", accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0,
    }, {});

    expect(result.credentials).toEqual({ username: "cliente", temporaryPassword: "Abcd2345Wxyz" });
    expect(clients.create).toHaveBeenCalledWith(expect.objectContaining({ email: "cliente@example.test" }), { username: "cliente", passwordHash: "scrypt$s$h" }, null);
    // El hash no sale en la respuesta: lo unico que viaja en claro es la clave.
    expect(JSON.stringify(result)).not.toContain("scrypt$s$h");
  });

  it("el servicio de credenciales emite una clave verificable contra su propio hash", async () => {
    const passwords = new PasswordService();
    const { temporaryPassword, passwordHash } = await new CredentialsService({} as never, passwords).issue("gestor");
    await expect(passwords.verify(temporaryPassword, passwordHash)).resolves.toBe(true);
  });

  it("una clave temporal sin cambiar bloquea cualquier ruta que no sea la de cambiarla", () => {
    const guard = new TemporaryPasswordGuard(reflector({}) as never);
    expect(() => guard.canActivate(context({ userId: "u1", mustChangePassword: true }))).toThrow(ForbiddenException);
    expect(guard.canActivate(context({ userId: "u1", mustChangePassword: false }))).toBe(true);
  });

  it("las rutas marcadas y las publicas siguen alcanzables con la clave temporal", () => {
    const exenta = new TemporaryPasswordGuard(reflector({ "auth:allows-temporary-password": true }) as never);
    expect(exenta.canActivate(context({ userId: "u1", mustChangePassword: true }))).toBe(true);
    const publica = new TemporaryPasswordGuard(reflector({ "auth:is-public": true }) as never);
    expect(publica.canActivate(context(undefined))).toBe(true);
  });
});

describe("Fase 12 - cambio de contraseña", () => {
  const passwords = new PasswordService();

  async function service(stored: string) {
    const authUser = { findUnique: vi.fn().mockResolvedValue({ id: "u1", passwordHash: stored }), update: vi.fn() };
    const refreshSession = { updateMany: vi.fn() };
    const database = { authUser, refreshSession, $transaction: vi.fn().mockResolvedValue([]) };
    return { database, service: new AuthService(database as never, passwords, {} as never) };
  }

  it("rechaza si la contraseña actual no coincide", async () => {
    const { service: auth } = await service(await passwords.hash("temporal-1"));
    await expect(auth.changePassword("u1", "otra", "nueva-larga-9")).rejects.toThrow(UnauthorizedException);
  });

  it("rechaza repetir la misma contraseña: dejaría la cuenta con la clave temporal", async () => {
    const { service: auth } = await service(await passwords.hash("temporal-1"));
    await expect(auth.changePassword("u1", "temporal-1", "temporal-1")).rejects.toThrow(UnauthorizedException);
  });

  it("al cambiarla limpia la bandera y revoca las sesiones abiertas, en una transacción", async () => {
    const { database, service: auth } = await service(await passwords.hash("temporal-1"));
    await expect(auth.changePassword("u1", "temporal-1", "nueva-larga-9")).resolves.toEqual({ success: true });
    expect(database.authUser.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) }));
    expect(database.refreshSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1", revokedAt: null } }));
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });
});
