import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaTeamRepository } from "../src/modules/team/infrastructure/prisma-team.repository";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { ManageTeam } from "../src/modules/team/application/use-cases/manage-team";
import { TeamMemberDetailView, TeamRepository } from "../src/modules/team/application/ports/team.repository";
import { normalizeUsername, validateTeamMember } from "../src/modules/team/domain/team-member";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";

const member = { id: "t1", username: "gestor", role: "GESTOR", status: "ACTIVE", mustChangePassword: true, createdAt: "2026-09-20T00:00:00.000Z", metrics: { clients: 0, sales: 0 } } as TeamMemberDetailView;
const issuer = () => ({ issue: vi.fn().mockResolvedValue({ username: "gestor", temporaryPassword: "Abcd2345Wxyz", passwordHash: "scrypt$s$h" }) });
/* El stub base no tiene cartera; los casos de baja necesitan uno que si. */
const conCartera = { ...member, metrics: { clients: 2, sales: 0 } } as TeamMemberDetailView;
const repositoryConCartera = (overrides: Partial<TeamRepository> = {}) =>
  repository({ findById: vi.fn().mockResolvedValue(conCartera), ...overrides });

const repository = (overrides: Partial<TeamRepository> = {}): TeamRepository => ({
  list: vi.fn().mockResolvedValue([member]),
  findById: vi.fn().mockResolvedValue(member),
  create: vi.fn().mockResolvedValue(member),
  update: vi.fn().mockResolvedValue(member),
  deactivate: vi.fn().mockResolvedValue({ member, movedClients: 2 }),
  resetPassword: vi.fn().mockResolvedValue(member),
  ...overrides,
});

describe("Fase 14 - reglas del equipo", () => {
  it.each([
    ["Gestor.Uno", "gestor.uno"],
    ["  ADMIN_2  ", "admin_2"],
  ])("normaliza el usuario %s", (input, expected) => {
    expect(normalizeUsername(input)).toBe(expected);
  });

  it.each(["ab", "con espacio", "a".repeat(25), "-empieza-con-guion", "acentós"])("rechaza el usuario %s", (username) => {
    expect(() => validateTeamMember({ username, role: "GESTOR" })).toThrowError(expect.objectContaining({ code: "INVALID_USERNAME" }));
  });

  /* Las mayusculas no se rechazan, se normalizan: escribir «Gestor» y que la
     pantalla conteste «usuario invalido» seria hostil sin motivo. */
  it("las mayusculas se aceptan y se guardan en minuscula", () => {
    expect(() => validateTeamMember({ username: "Gestor.Uno", role: "GESTOR" })).not.toThrow();
  });

  /* El equipo son usuarios internos: un cliente se administra en su propia
     pantalla, con plataformas, credito y recargas. */
  it("no admite el rol de cliente", () => {
    expect(() => validateTeamMember({ username: "alguien", role: "CLIENT" as never })).toThrowError(expect.objectContaining({ code: "INVALID_TEAM_ROLE" }));
  });

  it("crear devuelve la clave temporal una vez y guarda quien lo creo", async () => {
    const team = repository();
    const result = await new ManageTeam(team, issuer()).create({ username: "Gestor", role: "GESTOR" }, "admin-1");
    expect(result.credentials).toEqual({ username: "gestor", temporaryPassword: "Abcd2345Wxyz" });
    expect(team.create).toHaveBeenCalledWith({ username: "gestor", role: "GESTOR" }, { username: "gestor", passwordHash: "scrypt$s$h" }, "admin-1");
  });

  /* Un PATCH con status INACTIVE dejaria clientes apuntando a un gestor de
     baja: se desvia al camino que ademas libera la cartera. */
  /* La cartera no se suelta sola. Un gestor con clientes no se da de baja
     hasta que alguien dice a donde van: soltarla sigue siendo valido, pero
     hay que escribirlo. */
  it("desactivar a un gestor con cartera exige decir a donde va", async () => {
    const team = repositoryConCartera();
    await expect(new ManageTeam(team, issuer()).update("t1", { status: "INACTIVE" }))
      .rejects.toMatchObject({ code: "PORTFOLIO_DESTINATION_REQUIRED", status: 409 });
    expect(team.deactivate).not.toHaveBeenCalled();
    expect(team.update).not.toHaveBeenCalled();
  });

  it("el error dice cuantos clientes hay en juego", async () => {
    await expect(new ManageTeam(repositoryConCartera(), issuer()).deactivate("t1"))
      .rejects.toMatchObject({ message: expect.stringContaining("2 clientes asignados") });
  });

  it.each([
    ["reasignar", { kind: "reassign", managerId: "t2" } as const],
    ["soltar", { kind: "release" } as const],
  ])("con destino explicito (%s) la baja sigue adelante", async (_label, portfolio) => {
    const team = repositoryConCartera();
    const result = await new ManageTeam(team, issuer()).update("t1", { status: "INACTIVE", portfolio });
    expect(team.deactivate).toHaveBeenCalledWith("t1", portfolio);
    expect(team.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ movedClients: 2, portfolioDestination: portfolio.kind });
  });

  /* Sin cartera no hay nada que decidir, y pedirlo seria friccion sin motivo:
     es el caso de cualquier admin y el de un gestor que nunca recibio nada. */
  it("sin cartera la baja no pide destino", async () => {
    const team = repository();
    await expect(new ManageTeam(team, issuer()).deactivate("t1")).resolves.toBeDefined();
    expect(team.deactivate).toHaveBeenCalledWith("t1", { kind: "release" });
  });

  it("restablecer la clave devuelve una nueva y vuelve a exigir el cambio", async () => {
    const team = repository();
    const result = await new ManageTeam(team, issuer()).resetPassword("t1");
    expect(result.credentials.temporaryPassword).toBe("Abcd2345Wxyz");
    expect(team.resetPassword).toHaveBeenCalledWith("t1", "scrypt$s$h");
  });

  it("un usuario inexistente responde 404 en todas las operaciones", async () => {
    const team = repository({ findById: vi.fn().mockResolvedValue(null), deactivate: vi.fn().mockResolvedValue(null) });
    const manage = new ManageTeam(team, issuer());
    for (const call of [manage.get("x"), manage.update("x", { role: "GESTOR" }), manage.deactivate("x"), manage.resetPassword("x")]) {
      await expect(call).rejects.toMatchObject({ code: "TEAM_MEMBER_NOT_FOUND", status: 404 });
    }
  });
});

describe("Fase 14 - equipo contra la base", () => {
  let directory: string;
  let prisma: PrismaClient;
  let team: PrismaTeamRepository;
  let clients: PrismaClientAdminRepository;
  let gestor: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-team-"));
    const database = join(directory, "test.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), database);
    prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
    team = new PrismaTeamRepository(prisma as PrismaService);
    clients = new PrismaClientAdminRepository(prisma as PrismaService);

    const created = await team.create({ username: `gestor-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `gestor-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
    gestor = created.id;
    for (let index = 0; index < 2; index += 1) {
      const client = await clients.create(
        { name: `Cliente ${index}`, email: `${randomUUID()}@example.test`, accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 },
        { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" },
        gestor,
      );
      await prisma.rechargeTransaction.create({ data: {
        code: randomUUID(), idempotencyKey: randomUUID(), clientId: client.id, accountId: client.account.id,
        accountTypeSnapshot: "PREPAGO", rechargeStatus: "COMPLETED", pautaAmount: 100, totalAmount: 132.25,
        isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25,
      } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary path");
    rmSync(directory, { recursive: true, force: true });
  });

  it("el listado nunca incluye clientes, solo admins y gestores", async () => {
    const members = await team.list({});
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((item) => item.role === "ADMIN" || item.role === "GESTOR")).toBe(true);
  });

  it("las dos cajas del mockup cuentan cartera y ventas completadas", async () => {
    const members = await team.list({});
    expect(members.find((item) => item.id === gestor)?.metrics).toEqual({ clients: 2, sales: 2 });
  });

  it("el detalle trae los chips de cuentas y de ventas", async () => {
    const detail = await team.findById(gestor);
    expect(detail?.clients).toHaveLength(2);
    expect(detail?.sales).toHaveLength(2);
    expect(detail?.sales[0]).toMatchObject({ totalAmount: 132.25 });
  });

  it("un usuario con rol cliente no se encuentra por esta via", async () => {
    const cliente = await prisma.authUser.findFirstOrThrow({ where: { role: "CLIENT" } });
    await expect(team.findById(cliente.id)).resolves.toBeNull();
  });

  /* Soltar la cartera sigue siendo posible, pero ahora es una eleccion escrita
     y no lo que ocurre por omision. Los clientes siguen activos y quedan en la
     bandeja de sin asignar del admin. */
  it("la baja del gestor suelta los clientes sin darlos de baja", async () => {
    const result = await team.deactivate(gestor, { kind: "release" });
    expect(result?.movedClients).toBe(2);
    expect(result?.member.status).toBe("INACTIVE");
    const orphans = await prisma.client.findMany({ where: { managerId: null, status: "ACTIVE" } });
    expect(orphans.length).toBeGreaterThanOrEqual(2);
    await expect(team.list({ managerId: undefined } as never)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: gestor, metrics: { clients: 0, sales: 0 } })]));
  });

  it("no se puede crear un cliente colgando de un gestor inactivo", async () => {
    await expect(clients.create(
      { name: "Huerfano", email: `${randomUUID()}@example.test`, accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 },
      { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" },
      "no-existe",
    )).rejects.toMatchObject({ code: "MANAGER_NOT_ACTIVE", status: 409 });
  });

  it("no se puede asignar un cliente a un gestor inactivo", async () => {
    const orphan = await prisma.client.findFirstOrThrow({ where: { managerId: null } });
    await expect(clients.assignManager(orphan.id, gestor)).resolves.toBeUndefined();
  });

  it("asignar y desvincular mueven al cliente entre carteras", async () => {
    const active = await team.create({ username: `gestor-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `gestor-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
    const orphan = await prisma.client.findFirstOrThrow({ where: { managerId: null } });
    await expect(clients.assignManager(orphan.id, active.id)).resolves.toMatchObject({ manager: { id: active.id } });
    await expect(clients.assignManager(orphan.id, null)).resolves.toMatchObject({ manager: null });
  });

  it("el nombre de usuario repetido responde 409 y no crea nada", async () => {
    const username = `gestor-${randomUUID().slice(0, 8)}`;
    await team.create({ username, role: "GESTOR" }, { username, passwordHash: "scrypt$s$h" }, "auth-admin");
    await expect(team.create({ username, role: "ADMIN" }, { username, passwordHash: "scrypt$s$h" }, "auth-admin"))
      .rejects.toMatchObject({ code: "USERNAME_TAKEN", status: 409 });
  });

  /* El camino nuevo: en vez de soltar la cartera, pasarla entera a otro gestor
     en la misma transaccion que la baja. */
  it("la baja puede traspasar la cartera entera a otro gestor", async () => {
    const saliente = await team.create({ username: `sale-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `sale-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
    const entrante = await team.create({ username: `entra-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `entra-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
    const client = await clients.create(
      { name: "Traspasado", email: `${randomUUID()}@example.test`, accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 },
      { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" },
      saliente.id,
    );

    const result = await team.deactivate(saliente.id, { kind: "reassign", managerId: entrante.id });

    expect(result?.movedClients).toBe(1);
    expect(result?.member.status).toBe("INACTIVE");
    await expect(prisma.client.findUniqueOrThrow({ where: { id: client.id } }))
      .resolves.toMatchObject({ managerId: entrante.id, status: "ACTIVE" });
  });

  /* Reasignar a alguien de baja, a un admin o al propio saliente dejaria la
     cartera peor que soltandola, asi que no se toca nada. */
  it.each([
    ["un gestor inactivo", "inactivo"],
    ["un administrador", "admin"],
    ["el mismo que se da de baja", "self"],
    ["alguien que no existe", "fantasma"],
  ])("rechaza traspasar a %s sin tocar la cartera", async (_label, kind) => {
    const saliente = await team.create({ username: `s-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `s-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
    const client = await clients.create(
      { name: "Intacto", email: `${randomUUID()}@example.test`, accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 },
      { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" },
      saliente.id,
    );

    let target = "no-existe";
    if (kind === "self") target = saliente.id;
    if (kind === "admin") target = (await team.create({ username: `a-${randomUUID().slice(0, 8)}`, role: "ADMIN" }, { username: `a-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin")).id;
    if (kind === "inactivo") {
      const otro = await team.create({ username: `i-${randomUUID().slice(0, 8)}`, role: "GESTOR" }, { username: `i-${randomUUID().slice(0, 8)}`, passwordHash: "scrypt$s$h" }, "auth-admin");
      await team.deactivate(otro.id, { kind: "release" });
      target = otro.id;
    }

    await expect(team.deactivate(saliente.id, { kind: "reassign", managerId: target }))
      .rejects.toMatchObject({ code: "INVALID_PORTFOLIO_DESTINATION" });
    await expect(prisma.client.findUniqueOrThrow({ where: { id: client.id } }))
      .resolves.toMatchObject({ managerId: saliente.id });
    await expect(prisma.authUser.findUniqueOrThrow({ where: { id: saliente.id } }))
      .resolves.toMatchObject({ status: "ACTIVE" });
  });
});
