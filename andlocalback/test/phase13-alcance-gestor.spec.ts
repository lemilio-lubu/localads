import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { PrismaPhase7QueryRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-phase7-query.repository";
import { PrismaCampaignActivationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-campaign-activation.repository";
import { PrismaManagerScopeRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-manager-scope.repository";
import { AssertManagerScope } from "../src/modules/recharges/application/ports/manager-scope.ports";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { validRuc } from "./ruc-fixture";

const profile = (email: string) => ({ name: "Cliente", email, ruc: validRuc(), accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 });
const issuer = () => ({ prepare: vi.fn().mockResolvedValue({ username: `u-${randomUUID()}`, temporaryPassword: "Abcd2345Wxyz", passwordHash: "scrypt$s$h" }) });

describe("Fase 13 - alcance del gestor, en memoria", () => {
  const view = { id: "c1" } as AdminClientView;
  const repository = (overrides: Partial<ClientAdminRepository> = {}): ClientAdminRepository => ({
    create: vi.fn().mockResolvedValue(view),
    list: vi.fn().mockResolvedValue([view]),
    findById: vi.fn().mockResolvedValue(view),
    update: vi.fn().mockResolvedValue(view),
    deactivate: vi.fn().mockResolvedValue(view),
    ...overrides,
  });

  it("un gestor se asigna a si mismo el cliente que crea", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).create(profile("uno@example.test"), { managerId: "gestor-1" });
    expect(clients.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), "gestor-1");
  });

  it("un admin crea el cliente sin gestor cuando no elige ninguno", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).create(profile("dos@example.test"), {});
    expect(clients.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
  });

  it("un admin puede elegir el gestor al crear el cliente", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).create(profile("tres@example.test"), {}, " gestor-7 ");
    expect(clients.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), "gestor-7");
  });

  /* Si el cuerpo pudiera fijar el gestor, un gestor se asignaria clientes de
     otro. El token manda sobre lo que pida el request. */
  it("un gestor no puede asignar el cliente a otro desde el cuerpo", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).create(profile("cuatro@example.test"), { managerId: "gestor-1" }, "otro-gestor");
    expect(clients.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), "gestor-1");
  });

  /* Un cliente ajeno se comporta igual que uno inexistente: 404 y no 403, para
     no confirmar que existe ni de quien es. */
  it.each(["get", "update", "deactivate"] as const)("un cliente fuera de la cartera responde 404 en %s", async (operation) => {
    const clients = repository({ findById: vi.fn().mockResolvedValue(null) });
    const manage = new ManageClients(clients, issuer());
    const call = operation === "get" ? manage.get("ajeno", { managerId: "gestor-1" })
      : operation === "update" ? manage.update("ajeno", {}, { managerId: "gestor-1" })
      : manage.deactivate("ajeno", { managerId: "gestor-1" });
    await expect(call).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(clients.deactivate).not.toHaveBeenCalled();
  });

  it("el alcance llega hasta la consulta, no se filtra despues en memoria", async () => {
    const clients = repository();
    await new ManageClients(clients, issuer()).list({ managerId: "gestor-1" });
    expect(clients.list).toHaveBeenCalledWith({ managerId: "gestor-1" });
  });
});

describe("Fase 13 - alcance del gestor contra la base", () => {
  let directory: string;
  let prisma: PrismaClient;
  let clients: PrismaClientAdminRepository;
  let queries: PrismaPhase7QueryRepository;
  let activations: PrismaCampaignActivationRepository;
  let mine: string;
  let foreign: string;
  let mineTransaction: string;
  const managerId = "auth-gestor-test";

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-scope-"));
    const database = join(directory, "test.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), database);
    prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
    clients = new PrismaClientAdminRepository(prisma as PrismaService);
    queries = new PrismaPhase7QueryRepository(prisma as PrismaService);
    activations = new PrismaCampaignActivationRepository(prisma as PrismaService);

    await prisma.authUser.create({ data: { id: managerId, username: `gestor-${randomUUID()}`, passwordHash: "scrypt$s$h", role: "GESTOR", status: "ACTIVE" } });
    const own = await clients.create(profile(`${randomUUID()}@example.test`), { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" }, managerId);
    const other = await clients.create(profile(`${randomUUID()}@example.test`), { username: `u-${randomUUID()}`, passwordHash: "scrypt$s$h" }, null);
    mine = own.id;
    foreign = other.id;

    for (const [clientId, accountId] of [[own.id, own.account.id], [other.id, other.account.id]] as const) {
      const transaction = await prisma.rechargeTransaction.create({ data: {
        code: randomUUID(), idempotencyKey: randomUUID(), clientId, accountId,
        accountTypeSnapshot: "PREPAGO", rechargeStatus: "COMPLETED", pautaAmount: 100, totalAmount: 132.25,
        isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25,
        isdRateSnapshot: 0.05, agencyFeeRateSnapshot: 0.1, vatRateSnapshot: 0.15,
      } });
      if (clientId === own.id) mineTransaction = transaction.id;
      const payment = await prisma.payment.create({ data: { transactionId: transaction.id, status: "PENDING", expectedAmount: 132.25 } });
      const receipt = await prisma.paymentReceipt.create({ data: { paymentId: payment.id, originalName: "r.png", mimeType: "image/png", size: 10, url: `/receipts/${randomUUID()}`, checksum: randomUUID(), status: "PROCESSED" } });
      await prisma.transactionVerification.create({ data: { transactionId: transaction.id, paymentId: payment.id, receiptId: receipt.id, status: "UNDER_REVIEW", expectedAmount: 132.25, issues: "[]" } });
      await prisma.campaignActivationRequest.create({ data: { clientId, platform: "GOOGLE", status: "PENDING", requesterName: "Quien sea", phone: "0999", externalAccountId: randomUUID(), firstRechargeAmount: 50, activeRequestKey: randomUUID() } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary path");
    rmSync(directory, { recursive: true, force: true });
  });

  it("el listado de clientes solo devuelve la cartera del gestor", async () => {
    const own = await clients.list({ managerId });
    expect(own.map((client) => client.id)).toEqual([mine]);
    expect(own[0].manager).toMatchObject({ id: managerId });
    const all = await clients.list({});
    expect(all.map((client) => client.id)).toEqual(expect.arrayContaining([mine, foreign]));
  });

  it("un cliente ajeno no existe para el gestor", async () => {
    await expect(clients.findById(foreign, { managerId })).resolves.toBeNull();
    await expect(clients.findById(foreign, {})).resolves.not.toBeNull();
  });

  it("las transacciones y sus totales se recortan a la cartera", async () => {
    const own = await queries.listTransactions({ managerId, page: 1, pageSize: 50 });
    expect(own.items.every((item) => item.clientId === mine)).toBe(true);
    // El total describe el filtro completo: si se calculara sobre todas las
    // transacciones, el gestor veria dinero que no es de su cartera.
    expect(own.totals.pautaAmount).toBe(100);
    const all = await queries.listTransactions({ page: 1, pageSize: 50 });
    expect(all.totals.pautaAmount).toBeGreaterThan(own.totals.pautaAmount);
  });

  it("el detalle de una transaccion ajena no llega, y el propio si", async () => {
    await expect(queries.findTransactionDetail(mineTransaction, managerId)).resolves.not.toBeNull();
    const foreignTransaction = await prisma.rechargeTransaction.findFirstOrThrow({ where: { clientId: foreign } });
    await expect(queries.findTransactionDetail(foreignTransaction.id, managerId)).resolves.toBeNull();
    await expect(queries.findTransactionDetail(foreignTransaction.id)).resolves.not.toBeNull();
  });

  it("las verificaciones se recortan por la relacion transaccion-cliente", async () => {
    const own = await queries.listVerifications({ managerId, scope: "ALL", page: 1, pageSize: 50 });
    expect(own.items.length).toBe(1);
    expect(own.items.every((item) => item.clientId === mine)).toBe(true);
    const all = await queries.listVerifications({ scope: "ALL", page: 1, pageSize: 50 });
    expect(all.totalItems).toBeGreaterThan(own.totalItems);
  });

  /* El filtro por cliente y el recorte del gestor tienen que combinarse: si se
     pisaran, pedir un cliente ajeno devolveria sus verificaciones. */
  it("pedir un cliente ajeno con el recorte puesto no devuelve nada", async () => {
    const result = await queries.listVerifications({ managerId, clientId: foreign, scope: "ALL", page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(0);
  });

  /* Las decisiones -aprobar, activar, ejecutar- reciben un id suelto, asi que
     la pertenencia se comprueba antes de tocar nada. */
  it("la comprobacion de pertenencia distingue lo propio de lo ajeno", async () => {
    const ownership = new PrismaManagerScopeRepository(prisma as PrismaService);
    const foreignTransaction = await prisma.rechargeTransaction.findFirstOrThrow({ where: { clientId: foreign } });
    const ownVerification = await prisma.transactionVerification.findFirstOrThrow({ where: { transaction: { is: { clientId: mine } } } });
    const foreignVerification = await prisma.transactionVerification.findFirstOrThrow({ where: { transaction: { is: { clientId: foreign } } } });
    const foreignReceipt = await prisma.paymentReceipt.findFirstOrThrow({ where: { payment: { is: { transaction: { is: { clientId: foreign } } } } } });
    const foreignRequest = await prisma.campaignActivationRequest.findFirstOrThrow({ where: { clientId: foreign } });

    await expect(ownership.ownsTransaction(mineTransaction, managerId)).resolves.toBe(true);
    await expect(ownership.ownsTransaction(foreignTransaction.id, managerId)).resolves.toBe(false);
    await expect(ownership.ownsVerification(ownVerification.id, managerId)).resolves.toBe(true);
    await expect(ownership.ownsVerification(foreignVerification.id, managerId)).resolves.toBe(false);
    await expect(ownership.ownsReceipt(foreignReceipt.id, managerId)).resolves.toBe(false);
    await expect(ownership.ownsActivationRequest(foreignRequest.id, managerId)).resolves.toBe(false);
  });

  it("el gestor recibe 404 sobre lo ajeno y el admin no consulta siquiera", async () => {
    const assert = new AssertManagerScope(new PrismaManagerScopeRepository(prisma as PrismaService));
    const foreignTransaction = await prisma.rechargeTransaction.findFirstOrThrow({ where: { clientId: foreign } });
    await expect(assert.transaction(foreignTransaction.id, { managerId })).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND", status: 404 });
    await expect(assert.transaction(mineTransaction, { managerId })).resolves.toBeUndefined();
    // Sin recorte no hay consulta: el admin pasa aunque el id no exista.
    await expect(assert.transaction("no-existe", {})).resolves.toBeUndefined();
  });

  it("las solicitudes de activacion se recortan a la cartera", async () => {
    const own = await activations.list({ status: undefined, managerId });
    expect(own.every((request) => request.clientId === mine)).toBe(true);
    expect(own.length).toBe(1);
    const all = await activations.list({ status: undefined });
    expect(all.length).toBeGreaterThan(own.length);
  });
});
