import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PasswordService } from "../src/modules/auth/password.service";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { validRuc } from "./ruc-fixture";

const profile = (email: string) => ({ name: "Cliente", email, ruc: validRuc(), accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 });
const issuer = () => ({
  prepare: vi.fn(),
  issue: vi.fn().mockImplementation(async (username: string) => ({ username, temporaryPassword: "Abcd2345Wxyz", passwordHash: "scrypt$nuevo$h" })),
});

describe("Fase 15 - restablecer la clave de un cliente, en memoria", () => {
  const view = { id: "c1", name: "Cliente" } as AdminClientView;
  const repository = (overrides: Partial<ClientAdminRepository> = {}): ClientAdminRepository => ({
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn().mockResolvedValue(view), findDetail: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    assignManager: vi.fn(),
    findLoginUsername: vi.fn().mockResolvedValue("cliente"),
    resetPassword: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

  it("emite otra clave para el mismo usuario y la devuelve en claro una vez", async () => {
    const clients = repository();
    const credentials = issuer();
    const result = await new ManageClients(clients, credentials).resetPassword("c1", {});

    expect(credentials.issue).toHaveBeenCalledWith("cliente");
    expect(clients.resetPassword).toHaveBeenCalledWith("c1", "cliente", "scrypt$nuevo$h");
    expect(result.credentials).toEqual({ username: "cliente", temporaryPassword: "Abcd2345Wxyz" });
    expect(JSON.stringify(result)).not.toContain("scrypt$nuevo$h");
  });

  it("el gestor pasa su cartera como alcance a la consulta", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).resetPassword("c1", { managerId: "gestor-1" });
    expect(clients.findById).toHaveBeenCalledWith("c1", { managerId: "gestor-1" });
  });

  /* Fuera de la cartera responde igual que inexistente, y no se emite clave. */
  it("un cliente ajeno o inexistente responde 404 sin tocar la clave", async () => {
    const clients = repository({ findById: vi.fn().mockResolvedValue(null) });
    const credentials = issuer();
    await expect(new ManageClients(clients, credentials).resetPassword("c1", { managerId: "gestor-1" })).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(credentials.issue).not.toHaveBeenCalled();
    expect(clients.resetPassword).not.toHaveBeenCalled();
  });

  it("un cliente sin usuario de acceso responde 409", async () => {
    const clients = repository({ findLoginUsername: vi.fn().mockResolvedValue(null) });
    await expect(new ManageClients(clients, issuer()).resetPassword("c1", {})).rejects.toMatchObject({ code: "CLIENT_LOGIN_NOT_FOUND", status: 409 });
    expect(clients.resetPassword).not.toHaveBeenCalled();
  });

  it("si el usuario desaparece antes de escribir tambien responde 409", async () => {
    const clients = repository({ resetPassword: vi.fn().mockResolvedValue(false) });
    await expect(new ManageClients(clients, issuer()).resetPassword("c1", {})).rejects.toMatchObject({ code: "CLIENT_LOGIN_NOT_FOUND", status: 409 });
  });
});

describe("Fase 15 - restablecer la clave de un cliente contra la base", () => {
  let directory: string;
  let prisma: PrismaClient;
  let clients: PrismaClientAdminRepository;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-reset-"));
    const database = join(directory, "test.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), database);
    prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
    clients = new PrismaClientAdminRepository(prisma as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary path");
    rmSync(directory, { recursive: true, force: true });
  });

  it("la clave anterior deja de servir, se exige el cambio y las sesiones abiertas se revocan", async () => {
    const passwords = new PasswordService();
    const username = `u-${randomUUID()}`;
    const client = await clients.create(profile(`${randomUUID()}@example.test`), { username, passwordHash: await passwords.hash("ClaveVieja234") }, null);
    const user = await prisma.authUser.update({ where: { username }, data: { mustChangePassword: false } });
    await prisma.refreshSession.create({ data: { userId: user.id, tokenHash: randomUUID(), familyId: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });

    const result = await new ManageClients(clients, { prepare: vi.fn(), issue: async (name) => { const temporaryPassword = "Nueva2346Clav"; return { username: name, temporaryPassword, passwordHash: await passwords.hash(temporaryPassword) }; } }).resetPassword(client.id, {});

    const stored = await prisma.authUser.findUniqueOrThrow({ where: { username } });
    expect(result.credentials).toEqual({ username, temporaryPassword: "Nueva2346Clav" });
    await expect(passwords.verify("ClaveVieja234", stored.passwordHash)).resolves.toBe(false);
    await expect(passwords.verify("Nueva2346Clav", stored.passwordHash)).resolves.toBe(true);
    expect(stored.mustChangePassword).toBe(true);
    expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it("el gestor no alcanza a un cliente que no es de su cartera", async () => {
    const client = await clients.create(profile(`${randomUUID()}@example.test`), { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" }, null);
    await expect(new ManageClients(clients, issuer()).resetPassword(client.id, { managerId: "gestor-ajeno" })).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });
});
