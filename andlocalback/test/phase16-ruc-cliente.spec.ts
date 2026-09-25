import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { isValidCedula, validateRuc } from "../src/modules/clients/domain/ruc";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { validRuc } from "./ruc-fixture";

const rejects = (value: string, message: RegExp) => expect(() => validateRuc(value)).toThrowError(expect.objectContaining({ code: "INVALID_RUC", message: expect.stringMatching(message) }));

describe("Fase 16 - regla del RUC", () => {
  it("acepta una persona natural con cédula válida", () => {
    expect(validateRuc("1712345675001")).toBe("1712345675001");
    expect(isValidCedula("1712345675")).toBe(true);
  });

  it("normaliza espacios y guiones", () => {
    expect(validateRuc(" 17123456-75 001 ")).toBe("1712345675001");
  });

  it("acepta la provincia 30 de extranjeros", () => {
    const base = "300000000";
    const sum = [...base].reduce((total, digit, index) => { const product = Number(digit) * (index % 2 === 0 ? 2 : 1); return total + (product > 9 ? product - 9 : product); }, 0);
    expect(validateRuc(`${base}${(10 - (sum % 10)) % 10}001`)).toMatch(/^30/);
  });

  /* Sociedades y entidades publicas: estructura, sin exigir el modulo 11. */
  it("acepta sociedades y entidades públicas sin exigir el dígito verificador", () => {
    expect(validateRuc("1790011674001")).toBe("1790011674001");
    expect(validateRuc("1790000000001")).toBe("1790000000001");
    expect(validateRuc("1760000000001")).toBe("1760000000001");
  });

  it.each([
    ["", /obligatorio/],
    ["17123456750AB", /solo admite números/],
    ["171234567500", /13 dígitos/],
    ["17123456750011", /13 dígitos/],
    ["0012345675001", /provincia/],
    ["2512345675001", /provincia/],
    ["1712345670001", /cédula válida/],
    ["1712345675000", /000/],
    ["1760000000000", /0000/],
    ["1790011674000", /000/],
    ["1772345675001", /tercer dígito/],
    ["1782345675001", /tercer dígito/],
  ])("rechaza %s con el motivo concreto", (value, message) => {
    rejects(value, message);
  });

  it("el generador de los tests produce RUC válidos", () => {
    for (let index = 0; index < 50; index += 1) expect(() => validateRuc(validRuc())).not.toThrow();
  });
});

describe("Fase 16 - RUC en el caso de uso", () => {
  const view = { id: "c1", name: "Cliente", email: "c@example.test", ruc: "1712345675001", account: { type: AccountType.PREPAID, creditDays: 0, platforms: [AdvertisingPlatform.META] } } as AdminClientView;
  const repository = (overrides: Partial<ClientAdminRepository> = {}): ClientAdminRepository => ({
    create: vi.fn().mockResolvedValue(view), list: vi.fn(), findById: vi.fn().mockResolvedValue(view), findDetail: vi.fn(), update: vi.fn().mockResolvedValue(view),
    deactivate: vi.fn(), assignManager: vi.fn(), findLoginUsername: vi.fn(), resetPassword: vi.fn(), ...overrides,
  });
  const issuer = () => ({ prepare: vi.fn().mockResolvedValue({ username: "c", temporaryPassword: "Abcd2345Wxyz", passwordHash: "h" }), issue: vi.fn() });
  const profile = { name: "Cliente", email: "c@example.test", accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 };

  it("crear guarda el RUC normalizado", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).create({ ...profile, ruc: "1712345675-001" }, {});
    expect(clients.create).toHaveBeenCalledWith(expect.objectContaining({ ruc: "1712345675001" }), expect.anything(), null);
  });

  it("crear sin RUC o con uno inválido no llega a emitir credenciales", async () => {
    const clients = repository();
    const credentials = issuer();
    await expect(new ManageClients(clients, credentials).create({ ...profile, ruc: "" }, {})).rejects.toMatchObject({ code: "INVALID_RUC" });
    await expect(new ManageClients(clients, credentials).create({ ...profile, ruc: "1712345670001" }, {})).rejects.toMatchObject({ code: "INVALID_RUC" });
    expect(credentials.prepare).not.toHaveBeenCalled();
    expect(clients.create).not.toHaveBeenCalled();
  });

  it("editar sin mandar RUC no lo toca", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).update("c1", { name: "Otro" }, {});
    expect(clients.update).toHaveBeenCalledWith("c1", { name: "Otro" });
  });

  it("editar valida el RUC nuevo y vacío no sirve para borrarlo", async () => {
    const clients = repository();
    const manage = new ManageClients(clients, issuer());
    await manage.update("c1", { ruc: "0912345675 001" }, {});
    expect(clients.update).toHaveBeenCalledWith("c1", { ruc: "0912345675001" });
    await expect(manage.update("c1", { ruc: "" }, {})).rejects.toMatchObject({ code: "INVALID_RUC" });
  });
});

describe("Fase 16 - RUC contra la base", () => {
  let directory: string;
  let prisma: PrismaClient;
  let clients: PrismaClientAdminRepository;
  const profile = (ruc: string) => ({ name: "Cliente", email: `${randomUUID()}@example.test`, ruc, accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 });
  const credentials = () => ({ username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" });

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-ruc-"));
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

  it("guarda el RUC y lo devuelve en la vista", async () => {
    const ruc = validRuc();
    const created = await clients.create(profile(ruc), credentials(), null);
    expect(created.ruc).toBe(ruc);
  });

  it("un RUC repetido responde CLIENT_RUC_EXISTS, al crear y al editar", async () => {
    const ruc = validRuc();
    await clients.create(profile(ruc), credentials(), null);
    await expect(clients.create(profile(ruc), credentials(), null)).rejects.toMatchObject({ code: "CLIENT_RUC_EXISTS", status: 409 });
    const other = await clients.create(profile(validRuc()), credentials(), null);
    await expect(clients.update(other.id, { ruc })).rejects.toMatchObject({ code: "CLIENT_RUC_EXISTS", status: 409 });
  });
});
