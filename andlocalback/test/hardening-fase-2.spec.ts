import { Controller, Get, INestApplication, NotFoundException } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import { unexpectedErrorMessage, UnhandledErrorFilter } from "../src/common/errors/unhandled-error.filter";
import { createAppLogger, PinoNestLogger, serializeError } from "../src/common/observability/logger";
import { RequestContext } from "../src/common/observability/request-context";
import { requestLoggingMiddleware } from "../src/common/observability/request-logging.middleware";
import { PrismaClient } from "@prisma/client";
import { vi } from "vitest";
import { PrismaSecurityAuditLog } from "../src/common/audit/prisma-security-audit.log";
import { PrismaService } from "../src/database/prisma.service";
import { AccessTokenService } from "../src/modules/auth/access-token.service";
import { AuthService, IssuedSession, MfaChallenge } from "../src/modules/auth/auth.service";
import { MfaSecretCipher } from "../src/modules/auth/mfa-secret-cipher";
import { PasswordService } from "../src/modules/auth/password.service";
import { SecureFilesController } from "../src/modules/auth/secure-files.controller";
import { base32Decode, hotp, totpStep } from "../src/modules/auth/totp";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { TeamMemberDetailView, TeamRepository } from "../src/modules/team/application/ports/team.repository";
import { ManageTeam } from "../src/modules/team/application/use-cases/manage-team";
import { memoryDatabase, Row } from "./support/memory-auth-database";
import { createTestDatabase } from "./support/postgres-test-database";
import { recordingAudit } from "./support/security-audit";
import { ROLES_KEY } from "../src/modules/auth/auth.decorators";
import { actionsByCategory, SecurityEventsQuery } from "../src/modules/security-events/application/ports/security-events.query";
import { ListSecurityEvents } from "../src/modules/security-events/application/use-cases/list-security-events";
import { PrismaSecurityEventsQuery } from "../src/modules/security-events/infrastructure/prisma-security-events.query";
import { SecurityEventsController } from "../src/modules/security-events/presentation/security-events.controller";

/* Destino en memoria: cada linea de pino es un objeto JSON. */
function memoryLog() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line)); done(); } });
  return { lines, logger: createAppLogger({ LOG_LEVEL: "debug" }, stream) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

const prismaValidationError = () => new Prisma.PrismaClientValidationError(
  "Invalid `prisma.authUser.create()` invocation: { passwordHash: \"scrypt$sal$hash-secreto\" }",
  { clientVersion: "6.19.3" },
);

describe("2.1 logs estructurados", () => {
  it("tapa claves, tokens y cabeceras sensibles arriba y un nivel por debajo", async () => {
    const { lines, logger } = memoryLog();
    logger.info({ password: "clave-1", accessToken: "tok", body: { newPassword: "clave-2", refreshToken: "r" }, headers: { authorization: "Bearer x", cookie: "andlocal_refresh=y" }, ok: "visible" }, "prueba");
    await flush();
    const text = JSON.stringify(lines);
    for (const secret of ["clave-1", "clave-2", "tok\"", "Bearer x", "andlocal_refresh=y", "\"r\""]) expect(text).not.toContain(secret);
    expect(lines[0]).toMatchObject({ level: "info", msg: "prueba", ok: "visible", password: "[oculto]", service: "andlocalback" });
  });

  it("dentro de una peticion cada linea lleva su requestId y, ya autenticada, el usuario", async () => {
    const { lines, logger } = memoryLog();
    RequestContext.run({ requestId: "req-1", ip: "1.2.3.4", userAgent: null, userId: null }, () => {
      logger.info("antes");
      RequestContext.setUser("user-9");
      logger.info("despues");
    });
    logger.info("fuera");
    await flush();
    expect(lines[0]).toMatchObject({ requestId: "req-1" });
    expect(lines[0]).not.toHaveProperty("userId");
    expect(lines[1]).toMatchObject({ requestId: "req-1", userId: "user-9" });
    expect(lines[2]).not.toHaveProperty("requestId");
  });

  it("de un error de Prisma guarda tipo, codigo y traza, pero no el mensaje con los argumentos", () => {
    const serialized = serializeError(prismaValidationError());
    expect(serialized.type).toBe("PrismaClientValidationError");
    expect(JSON.stringify(serialized)).not.toContain("hash-secreto");
    const known = serializeError(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target: ["ruc"] } }));
    expect(known).toMatchObject({ code: "P2002", meta: { target: ["ruc"] } });
    expect(known).not.toHaveProperty("message");
    expect(serializeError(new TypeError("x is undefined"))).toMatchObject({ type: "TypeError", message: "x is undefined" });
  });

  it("adapta el Logger de Nest: contexto, nivel y traza", async () => {
    const { lines, logger } = memoryLog();
    const nest = new PinoNestLogger(logger);
    nest.log("arranco", "NestApplication");
    nest.warn("ojo", "InvoiceAuthorizationRunner");
    nest.error("fallo", "Error: x\n    at f (a.ts:1:1)", "OverduePaymentsRunner");
    nest.error(prismaValidationError());
    await flush();
    expect(lines[0]).toMatchObject({ level: "info", context: "NestApplication", msg: "arranco" });
    expect(lines[1]).toMatchObject({ level: "warn", context: "InvoiceAuthorizationRunner" });
    expect(lines[2]).toMatchObject({ level: "error", context: "OverduePaymentsRunner", msg: "fallo" });
    expect(String(lines[2].stack)).toContain("at f");
    expect(JSON.stringify(lines[3])).not.toContain("hash-secreto");
  });
});

@Controller("prueba")
class ProbeController {
  @Get("ok") ok() { return { ok: true }; }
  @Get("type-error") typeError() { throw new TypeError("Cannot read properties of undefined (reading 'ruc')"); }
  @Get("prisma") prisma() { throw prismaValidationError(); }
  @Get("not-found") notFound() { throw new NotFoundException("Comprobante no encontrado"); }
  @Get("application") application() { throw new ApplicationError("USERNAME_TAKEN", "Ya existe un acceso con este correo", 409); }
}

describe("2.1 y 2.3 sobre HTTP real", () => {
  const log = memoryLog();
  let app: INestApplication; let base = "";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController], providers: [{ provide: APP_FILTER, useClass: UnhandledErrorFilter }] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useLogger(new PinoNestLogger(log.logger));
    app.use(requestLoggingMiddleware(log.logger));
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/prueba`;
  });
  afterAll(async () => { await app.close(); });

  it("un error desconocido es un 500 generico con requestId; el detalle queda solo en el log", async () => {
    const response = await fetch(`${base}/type-error`);
    const body = await response.json() as Record<string, unknown>;
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(body).toEqual({ statusCode: 500, code: "INTERNAL_ERROR", message: unexpectedErrorMessage, requestId });
    expect(JSON.stringify(body)).not.toContain("ruc");
    await flush();
    const detail = log.lines.find((line) => line.msg === "Error no controlado" && line.requestId === requestId);
    expect(detail).toMatchObject({ level: "error", context: "HTTP", path: "/prueba/type-error", error: { type: "TypeError" } });
  });

  it("un error de Prisma no filtra nada ni en la respuesta ni en el log", async () => {
    const response = await fetch(`${base}/prisma`);
    expect(response.status).toBe(500);
    await flush();
    expect(JSON.stringify(await response.json())).not.toMatch(/prisma|hash-secreto/i);
    expect(JSON.stringify(log.lines)).not.toContain("hash-secreto");
  });

  it("las HttpException y los ApplicationError conservan su respuesta", async () => {
    const notFound = await fetch(`${base}/not-found`);
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ statusCode: 404, message: "Comprobante no encontrado", error: "Not Found" });
    const conflict = await fetch(`${base}/application`);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ statusCode: 409, code: "USERNAME_TAKEN", message: "Ya existe un acceso con este correo" });
  });

  it("cada peticion deja una linea con campos permitidos y un requestId distinto", async () => {
    const first = await fetch(`${base}/ok?ruc=1790012345001&email=ana@example.test`, { headers: { authorization: "Bearer secreto", "user-agent": "vitest" } });
    const second = await fetch(`${base}/ok`);
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
    await flush();
    const line = log.lines.find((entry) => entry.requestId === first.headers.get("x-request-id") && entry.msg === "petición");
    expect(line).toMatchObject({ level: "info", method: "GET", path: "/prueba/ok", status: 200, userAgent: "vitest" });
    expect(typeof line?.durationMs).toBe("number");
    const text = JSON.stringify(log.lines);
    expect(text).not.toContain("1790012345001");
    expect(text).not.toContain("Bearer secreto");
    const failure = log.lines.find((entry) => entry.msg === "petición" && entry.path === "/prueba/not-found");
    expect(failure?.level).toBe("warn");
  });
});

/* ---------------------------------------------------------------------------
   2.2 Auditoria de seguridad
   ------------------------------------------------------------------------- */

const password = "tres palabras cualquiera";
const actions = (audit: ReturnType<typeof recordingAudit>) => audit.events.map((event) => event.action);

describe("2.2 eventos de acceso", () => {
  const passwords = new PasswordService();
  const cipher = MfaSecretCipher.fromEnv({});

  async function setup(extra: Row = {}) {
    const user: Row = {
      id: "u1", username: "marta@andlocal.ec", name: "Marta", passwordHash: await passwords.hash(password), role: "GESTOR", status: "ACTIVE",
      clientId: null, accountId: null, accountType: null, mustChangePassword: false, tokenVersion: 0, failedLoginCount: 0, lockedUntil: null,
      mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], ...extra,
    };
    const audit = recordingAudit();
    const auth = new AuthService(memoryDatabase([user]) as never, passwords, new AccessTokenService(), cipher, { invalidate: vi.fn() } as never, audit);
    return { user, audit, auth };
  }

  it("un correo que no existe deja el fallo sin objetivo y sin el texto tecleado", async () => {
    const { audit, auth } = await setup();
    await auth.login("clave-en-el-campo-equivocado", "x").catch(() => undefined);
    expect(audit.events).toEqual([{ action: "LOGIN_FAILED", outcome: "FAILURE", actorUserId: null, detail: { reason: "UNKNOWN_USER" } }]);
    expect(JSON.stringify(audit.events)).not.toContain("clave-en-el-campo-equivocado");
  });

  it("cinco claves malas: cinco fallos y un bloqueo; durante el bloqueo, fallo por bloqueo", async () => {
    const { audit, auth } = await setup();
    for (let attempt = 0; attempt < 5; attempt += 1) await auth.login("marta@andlocal.ec", "mala").catch(() => undefined);
    await auth.login("marta@andlocal.ec", password).catch(() => undefined);
    expect(actions(audit)).toEqual([...Array(5).fill("LOGIN_FAILED"), "ACCOUNT_LOCKED", "LOGIN_FAILED"]);
    expect(audit.events[0]).toMatchObject({ target: { type: "USER", id: "u1" }, detail: { reason: "BAD_PASSWORD" } });
    expect(audit.events[5]).toMatchObject({ outcome: "DENIED", detail: { failedLoginCount: 5 } });
    expect(audit.events[6]).toMatchObject({ detail: { reason: "LOCKED" } });
  });

  it("login correcto, cambio de clave y cierre de sesion, cada uno con su actor", async () => {
    const { audit, auth } = await setup();
    const session = await auth.login("marta@andlocal.ec", password) as IssuedSession;
    await auth.changePassword("u1", "mala", "otra frase bastante larga").catch(() => undefined);
    await auth.logout(session.refreshToken);
    await auth.logout(session.refreshToken);
    await auth.changePassword("u1", password, "otra frase bastante larga");
    expect(actions(audit)).toEqual(["LOGIN_SUCCEEDED", "PASSWORD_CHANGE_FAILED", "LOGOUT", "PASSWORD_CHANGED"]);
    expect(audit.events[0]).toMatchObject({ actorUserId: "u1", detail: { method: "PASSWORD", role: "GESTOR" } });
    expect(audit.events[2]).toMatchObject({ actorUserId: "u1", target: { type: "USER", id: "u1" } });
    const text = JSON.stringify(audit.events);
    for (const secret of [password, "otra frase", session.refreshToken]) expect(text).not.toContain(secret);
  });

  it("doble factor: alta, codigo fallido, codigo de recuperacion y baja", async () => {
    const { audit, auth } = await setup();
    const { secret } = await auth.startEnrollment("u1");
    const code = (offset = 0) => hotp(base32Decode(secret), totpStep() + offset);
    const { recoveryCodes } = await auth.confirmEnrollment("u1", code());
    const challenge = await auth.login("marta@andlocal.ec", password) as MfaChallenge;
    await auth.verifyMfa(challenge.challengeToken, "000000").catch(() => undefined);
    await auth.verifyMfa(challenge.challengeToken, recoveryCodes[0]);
    await auth.disableMfa("u1", password, "000000").catch(() => undefined);
    await auth.disableMfa("u1", password, recoveryCodes[1]);
    expect(actions(audit)).toEqual(["MFA_ENABLED", "MFA_VERIFY_FAILED", "MFA_RECOVERY_CODE_USED", "LOGIN_SUCCEEDED", "MFA_DISABLE_FAILED", "MFA_DISABLED"]);
    expect(audit.events[3]).toMatchObject({ detail: { method: "RECOVERY_CODE" } });
    expect(audit.events[4]).toMatchObject({ detail: { reason: "BAD_CODE" } });
    const text = JSON.stringify(audit.events);
    for (const value of [secret, recoveryCodes[0], recoveryCodes[1]]) expect(text).not.toContain(value);
  });

  it("reusar un refresh rotado fuera del margen queda como posible robo", async () => {
    vi.useFakeTimers();
    try {
      const { audit, auth } = await setup();
      const session = await auth.login("marta@andlocal.ec", password) as IssuedSession;
      await auth.refresh(session.refreshToken);
      vi.advanceTimersByTime(31_000);
      await auth.refresh(session.refreshToken).catch(() => undefined);
      expect(audit.events.at(-1)).toMatchObject({ action: "REFRESH_TOKEN_REUSED", outcome: "DENIED", target: { type: "USER", id: "u1" } });
    } finally { vi.useRealTimers(); }
  });
});

describe("2.2 eventos de administracion", () => {
  const member = { id: "t1", username: "gestor@andlocal.ec", name: "Gestor Uno", role: "GESTOR", status: "ACTIVE", mustChangePassword: false, mfaEnabled: true, createdAt: "2026-11-01T00:00:00.000Z", metrics: { clients: 0, sales: 0 } } as TeamMemberDetailView;
  const teamRepository = (overrides: Partial<TeamRepository> = {}): TeamRepository => ({
    list: vi.fn(), findById: vi.fn().mockResolvedValue(member), create: vi.fn().mockResolvedValue(member),
    update: vi.fn().mockResolvedValue(member), deactivate: vi.fn().mockResolvedValue({ member, movedClients: 3 }),
    resetPassword: vi.fn().mockResolvedValue(member), resetMfa: vi.fn().mockResolvedValue(member), ...overrides,
  });
  const issuer = { issue: vi.fn().mockResolvedValue({ username: "x", temporaryPassword: "Temporal-9999", passwordHash: "scrypt$s$h" }), prepare: vi.fn().mockResolvedValue({ username: "x", temporaryPassword: "Temporal-9999", passwordHash: "scrypt$s$h" }) };

  it("equipo: alta, cambio de rol, edicion, baja con cartera y resets", async () => {
    const audit = recordingAudit();
    const team = new ManageTeam(teamRepository({ update: vi.fn().mockResolvedValue({ ...member, role: "ADMIN", name: "Gestora Uno" }) }), issuer, audit);
    await team.create({ username: "gestor@andlocal.ec", name: "Gestor Uno", role: "GESTOR" }, "admin-1");
    await team.update("t1", { role: "ADMIN", name: "Gestora Uno" });
    await team.deactivate("t1", { kind: "reassign", managerId: "t9" });
    await team.resetPassword("t1");
    await team.resetMfa("t1", "admin-1");
    expect(actions(audit)).toEqual(["TEAM_MEMBER_CREATED", "TEAM_ROLE_CHANGED", "TEAM_MEMBER_UPDATED", "TEAM_MEMBER_DEACTIVATED", "TEAM_PASSWORD_RESET", "TEAM_MFA_RESET"]);
    expect(audit.events[1]).toMatchObject({ target: { type: "USER", id: "t1" }, detail: { from: "GESTOR", to: "ADMIN" } });
    expect(audit.events[2]).toMatchObject({ detail: { fields: ["name"] } });
    expect(audit.events[3]).toMatchObject({ detail: { movedClients: 3, portfolioDestination: "reassign", reassignedTo: "t9" } });
    expect(JSON.stringify(audit.events)).not.toContain("Temporal-9999");
  });

  it("equipo: un intento rechazado no deja evento de exito", async () => {
    const audit = recordingAudit();
    await new ManageTeam(teamRepository(), issuer, audit).resetMfa("admin-1", "admin-1").catch(() => undefined);
    expect(audit.events).toEqual([]);
  });

  it("clientes: los cambios guardan nombres de campo, nunca RUC ni correo", async () => {
    const audit = recordingAudit();
    const view = { id: "c1", name: "Cliente", email: "c@example.test", ruc: "1790012345001", manager: { id: "g1", username: "g1" }, status: "ACTIVE", account: { type: "PREPAGO", creditDays: 0, creditLimit: 0, platforms: ["META"] } } as unknown as AdminClientView;
    const repository = {
      findById: vi.fn().mockResolvedValue(view), update: vi.fn().mockResolvedValue(view), assignManager: vi.fn().mockResolvedValue(view),
      deactivate: vi.fn().mockResolvedValue(view), findLoginUsername: vi.fn().mockResolvedValue("c@example.test"), resetPassword: vi.fn().mockResolvedValue(true),
    } as unknown as ClientAdminRepository;
    const clients = new ManageClients(repository, issuer, audit);
    await clients.update("c1", { ruc: "1790012345001", email: "nuevo@example.test", administratorId: "admin-1" }, {});
    await clients.assignManager("c1", "g2");
    await clients.resetPassword("c1", {});
    await clients.deactivate("c1", {});
    expect(actions(audit)).toEqual(["CLIENT_UPDATED", "CLIENT_MANAGER_ASSIGNED", "CLIENT_PASSWORD_RESET", "CLIENT_DEACTIVATED"]);
    expect(audit.events[0].detail).toEqual({ fields: ["email", "ruc"] });
    expect(audit.events[1].detail).toEqual({ from: "g1", to: "g2" });
    expect(JSON.stringify(audit.events)).not.toMatch(/1790012345001|nuevo@example|Temporal-9999/);
  });

  it("comprobantes: quien lo abre y quien lo intenta sin permiso", async () => {
    const audit = recordingAudit();
    const database = { paymentReceipt: { findUnique: vi.fn().mockResolvedValue({ originalName: "t.png", mimeType: "image/png", url: "r2://k", payment: { transaction: { clientId: "client-1", client: { managerId: "gestor-1" } } } }) } };
    const storage = { put: vi.fn(), get: vi.fn().mockResolvedValue(Buffer.from("x")) };
    const response = { type: vi.fn(), set: vi.fn(), send: vi.fn() };
    const controller = new SecureFilesController(database as never, storage, audit);
    const principal = (userId: string, role: "ADMIN" | "GESTOR") => ({ userId, username: userId, role, clientId: null, accountId: null, accountType: null });
    await controller.receiptContent("rcp-1", principal("admin-1", "ADMIN"), response as never);
    await controller.receiptContent("rcp-1", principal("gestor-2", "GESTOR"), response as never).catch(() => undefined);
    expect(audit.events).toEqual([
      { action: "RECEIPT_VIEWED", outcome: "SUCCESS", actorUserId: "admin-1", target: { type: "RECEIPT", id: "rcp-1" }, detail: { role: "ADMIN" } },
      { action: "RECEIPT_ACCESS_DENIED", outcome: "DENIED", actorUserId: "gestor-2", target: { type: "RECEIPT", id: "rcp-1" }, detail: { role: "GESTOR" } },
    ]);
  });
});

describe("2.2 registro en PostgreSQL", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    testDatabase = await createTestDatabase("hardening_fase_2");
    prisma = new PrismaClient({ datasourceUrl: testDatabase.url });
  }, 120_000);
  afterAll(async () => { await prisma?.$disconnect(); await testDatabase?.drop(); });

  it("completa IP, user-agent, requestId y actor desde la peticion en curso", async () => {
    const log = new PrismaSecurityAuditLog(prisma as PrismaService);
    await RequestContext.run({ requestId: "req-audit-1", ip: "200.1.2.3", userAgent: "Firefox", userId: "admin-1" }, () =>
      log.record({ action: "CLIENT_DEACTIVATED", outcome: "SUCCESS", target: { type: "CLIENT", id: "c1" } }));
    await log.record({ action: "LOGIN_FAILED", outcome: "FAILURE", actorUserId: null, detail: { reason: "UNKNOWN_USER" } });
    const rows = await prisma.securityAuditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(rows[0]).toMatchObject({ action: "CLIENT_DEACTIVATED", actorUserId: "admin-1", targetType: "CLIENT", targetId: "c1", ip: "200.1.2.3", userAgent: "Firefox", requestId: "req-audit-1", detail: null });
    expect(rows[1]).toMatchObject({ action: "LOGIN_FAILED", actorUserId: null, ip: null, detail: { reason: "UNKNOWN_USER" } });
  });

  it("la tabla es de solo insercion: UPDATE, DELETE y TRUNCATE fallan", async () => {
    const [row] = await prisma.securityAuditEvent.findMany({ take: 1 });
    await expect(prisma.securityAuditEvent.update({ where: { id: row.id }, data: { outcome: "SUCCESS" } })).rejects.toThrow(/solo inserción/);
    await expect(prisma.securityAuditEvent.deleteMany({})).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "SecurityAuditEvent"')).rejects.toThrow(/solo inserción/);
    expect(await prisma.securityAuditEvent.count()).toBe(2);
  });

  it("la consulta del admin pone nombres, filtra y busca por persona o por codigo de referencia", async () => {
    const log = new PrismaSecurityAuditLog(prisma as PrismaService);
    await RequestContext.run({ requestId: "4fbfb81d-0000-4000-8000-000000000001", ip: "200.1.2.3", userAgent: "Firefox", userId: "auth-admin" }, () =>
      log.record({ action: "CLIENT_MANAGER_ASSIGNED", outcome: "SUCCESS", target: { type: "CLIENT", id: "client-001" }, detail: { from: null, to: "auth-gestor" } }));
    await log.record({ action: "RECEIPT_ACCESS_DENIED", outcome: "DENIED", actorUserId: "auth-gestor", target: { type: "RECEIPT", id: "no-existe" } });
    const query = new PrismaSecurityEventsQuery(prisma as PrismaService);
    const all = await query.list({ page: 1, pageSize: 25 });
    expect(all.total).toBe(4);
    const assigned = all.items.find((item) => item.action === "CLIENT_MANAGER_ASSIGNED");
    expect(assigned).toMatchObject({ actor: { id: "auth-admin", label: "Administrador" }, target: { type: "CLIENT", label: "Migo Prepago" }, ip: "200.1.2.3" });
    expect(all.people["auth-gestor"]).toBe("Gestor de prueba");
    expect(all.items.find((item) => item.action === "RECEIPT_ACCESS_DENIED")?.target?.label).toBe("registro eliminado");
    expect(all.items.find((item) => item.action === "CLIENT_DEACTIVATED")?.actor?.label).toBe("usuario eliminado");

    const problems = await query.list({ problemsOnly: true, page: 1, pageSize: 25 });
    expect(problems.items.map((item) => item.action).sort()).toEqual(["LOGIN_FAILED", "RECEIPT_ACCESS_DENIED"]);
    expect((await query.list({ actions: actionsByCategory.clients, page: 1, pageSize: 25 })).total).toBe(2);
    expect((await query.list({ search: "gestor de PRUEBA", page: 1, pageSize: 25 })).items.map((item) => item.action)).toEqual(["RECEIPT_ACCESS_DENIED"]);
    expect((await query.list({ search: "migo prepago", page: 1, pageSize: 25 })).items.map((item) => item.action)).toEqual(["CLIENT_MANAGER_ASSIGNED"]);
    expect((await query.list({ search: "4fbfb81d", page: 1, pageSize: 25 })).items.map((item) => item.action)).toEqual(["CLIENT_MANAGER_ASSIGNED"]);
    const paged = await query.list({ page: 2, pageSize: 3 });
    expect(paged).toMatchObject({ page: 2, totalPages: 2, total: 4 });
    expect(paged.items).toHaveLength(1);
  });

  it("si no puede guardar, no rompe la operacion", async () => {
    const broken = { securityAuditEvent: { create: vi.fn().mockRejectedValue(new Error("sin conexion")) } };
    await expect(new PrismaSecurityAuditLog(broken as never).record({ action: "LOGOUT", outcome: "SUCCESS" })).resolves.toBeUndefined();
  });
});

describe("2.2 consulta del registro", () => {
  const empty = { items: [], page: 1, totalPages: 1, total: 0, people: {} };

  it("traduce el grupo a sus acciones, limpia la busqueda y pagina de 25 en 25", async () => {
    const events: SecurityEventsQuery = { list: vi.fn().mockResolvedValue(empty) };
    await new ListSecurityEvents(events).execute({ category: "receipts", problemsOnly: true, search: "  ana  ", page: 3 });
    expect(events.list).toHaveBeenCalledWith({ actions: ["RECEIPT_VIEWED", "RECEIPT_ACCESS_DENIED"], problemsOnly: true, search: "ana", page: 3, pageSize: 25 });
    await new ListSecurityEvents(events).execute({ search: "   " });
    expect(events.list).toHaveBeenLastCalledWith({ problemsOnly: false, page: 1, pageSize: 25 });
    await expect(new ListSecurityEvents(events).execute({ page: 0 })).rejects.toMatchObject({ code: "INVALID_PAGE" });
  });

  it("cada accion del registro esta en un solo grupo", () => {
    const grouped = Object.values(actionsByCategory).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped).toHaveLength(26);
  });

  it("solo el admin la consulta", () => {
    expect(Reflect.getMetadata(ROLES_KEY, SecurityEventsController)).toEqual(["ADMIN"]);
  });
});
