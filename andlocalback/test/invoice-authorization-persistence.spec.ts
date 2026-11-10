import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { PrismaInvoiceAuthorizationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-invoice-authorization.repository";
import { createTestDatabase } from "./support/postgres-test-database";

describe("persistencia de la autorización de facturas", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;
  let repository: PrismaInvoiceAuthorizationRepository;
  const now = new Date("2026-10-21T20:00:00.000Z");
  const later = new Date(now.getTime() + 5 * 60_000);

  beforeAll(async () => {
    testDatabase = await createTestDatabase("invoice_authorization");
    prisma = new PrismaClient({ datasourceUrl: testDatabase.url });
    repository = new PrismaInvoiceAuthorizationRepository(prisma as PrismaService);
    await prisma.client.create({ data: { id: "fac-client", name: "Cliente Factura", email: "factura@example.test", ruc: "1790012345001", status: "ACTIVE", managerId: null } });
    await prisma.account.create({ data: { id: "fac-account", clientId: "fac-client", status: "ACTIVE", type: AccountType.POSTPAID, creditDays: 30 } });
    await prisma.pauta.create({ data: { id: "fac-meta", clientId: "fac-client", platform: AdvertisingPlatform.META, status: "ACTIVE", currentBalance: new Prisma.Decimal("25") } });
    for (const id of ["a", "b", "c", "d", "e"]) await invoice(id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await testDatabase.drop();
  });

  it("solo uno de dos procesos simultáneos reserva la misma factura", async () => {
    const claims = await Promise.all([1, 2, 3, 4].map(() => repository.claimForAuthorization("fac-inv-a", now, later)));
    expect(claims.filter((claim) => claim.kind === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === "IN_PROGRESS")).toHaveLength(3);
  });

  it("entrega cliente, líneas y totales en centavos exactos", async () => {
    const claim = await repository.claimForAuthorization("fac-inv-b", now, later);
    if (claim.kind !== "CLAIMED") throw new Error(`esperaba CLAIMED, llegó ${claim.kind}`);
    expect(claim.request.customer).toEqual({ name: "Cliente Factura", ruc: "1790012345001", email: "factura@example.test", address: null, phone: null });
    expect(claim.request.lines.map((line) => [line.description, line.amount.toMajorUnits()])).toEqual([["Recarga publicitaria Meta", "25.00"]]);
    expect(claim.request.totals.totalAmount.toMajorUnits()).toBe("33.06");
    expect(claim.request.invoiceNumber).toBe("FAC-TX-FAC-b");
    // Lo que necesita el proveedor fiscal: base, IVA y total por línea y cómo se pagó.
    const [line] = claim.request.lines;
    expect([line.vatBaseAmount, line.vatAmount, line.totalAmount].map((value) => value.toMajorUnits())).toEqual(["28.75", "4.31", "33.06"]);
    expect(claim.request.payment).toEqual({ mode: "POSTPAID", creditDays: 30 });
    expect(claim.request.externalReference).toBeNull();
  });

  it("enviada al proveedor, guarda su referencia y número fiscal, libera la reserva y sigue pendiente", async () => {
    await repository.claimForAuthorization("fac-inv-d", now, later);
    await repository.markSubmitted({ invoiceId: "fac-inv-d", issuer: "migo", externalReference: "4521", fiscalNumber: "001-001-000000123", error: null });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-d" } });
    expect(stored).toMatchObject({ issuer: "migo", externalReference: "4521", fiscalNumber: "001-001-000000123", authorizationNumber: null, authorizationClaimedUntil: null, authorizationError: null });
    expect(await repository.listPendingAuthorization(now, 10)).toContain("fac-inv-d");
    // El siguiente intento recibe la referencia: consultará esa factura, no emitirá otra.
    const again = await repository.claimForAuthorization("fac-inv-d", now, later);
    expect(again.kind === "CLAIMED" && again.request.externalReference).toBe("4521");

    await repository.markAuthorized({
      invoiceId: "fac-inv-d", issuer: "migo", externalReference: "4521", documentUrl: "/files/invoices/fac-inv-d/content",
      authorization: { authorizationNumber: "0711202601179001234500120010010000001231234567811", authorizedAt: later, fiscalNumber: "001-001-000000123" },
    });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-d" } })).toMatchObject({
      authorizationNumber: "0711202601179001234500120010010000001231234567811", fiscalNumber: "001-001-000000123", externalReference: "4521", authorizationClaimedUntil: null,
    });
    const source = await repository.loadDocumentSource("fac-inv-d");
    expect(source?.authorization?.fiscalNumber).toBe("001-001-000000123");
  });

  it("un rechazo guarda la referencia con el motivo, y un envío rezagado no pisa una factura ya autorizada", async () => {
    await repository.markSubmitted({ invoiceId: "fac-inv-e", issuer: "migo", externalReference: "88", fiscalNumber: null, error: "SRI: RUC inexistente" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-e" } })).toMatchObject({ externalReference: "88", authorizationError: "SRI: RUC inexistente" });

    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-d" } });
    await repository.markSubmitted({ invoiceId: "fac-inv-d", issuer: "migo", externalReference: "otra", fiscalNumber: null, error: "tarde" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-d" } })).toEqual(before);
  });

  it("autorizada, guarda número y documento y no se vuelve a reservar", async () => {
    await repository.markAuthorized({ invoiceId: "fac-inv-a", issuer: "simulado", authorization: { authorizationNumber: "SIM-1", authorizedAt: now, fiscalNumber: null }, externalReference: null, documentUrl: "/files/invoices/fac-inv-a/content" });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-a" } });
    expect(stored).toMatchObject({ authorizationNumber: "SIM-1", issuer: "simulado", documentUrl: "/files/invoices/fac-inv-a/content", authorizationClaimedUntil: null, authorizationError: null });
    expect((await repository.claimForAuthorization("fac-inv-a", later, later)).kind).toBe("ALREADY_AUTHORIZED");
    expect((await repository.claimForAuthorization("no-existe", now, later)).kind).toBe("NOT_FOUND");
  });

  it("un fallo libera la reserva con su motivo y la deja en la lista de pendientes", async () => {
    await repository.releaseAfterFailure({ invoiceId: "fac-inv-b", reason: "Serguéi no responde" });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-b" } });
    expect(stored).toMatchObject({ authorizationClaimedUntil: null, authorizationError: "Serguéi no responde" });
    // a y d: autorizadas; b: liberada; c: nunca reservada; e: rechazada, se
    // vuelve a consultar. Una reserva vigente tampoco sale.
    await repository.claimForAuthorization("fac-inv-c", now, later);
    expect(await repository.listPendingAuthorization(now, 10)).toEqual(["fac-inv-b", "fac-inv-e"]);
    expect(await repository.listPendingAuthorization(new Date(later.getTime() + 1), 10)).toEqual(["fac-inv-b", "fac-inv-c", "fac-inv-e"]);
  });

  it("el origen del documento lleva al dueño y la autorización", async () => {
    const source = await repository.loadDocumentSource("fac-inv-a");
    expect(source?.owner).toEqual({ clientId: "fac-client", managerId: null });
    expect(source?.authorization).toEqual({ authorizationNumber: "SIM-1", authorizedAt: now, fiscalNumber: null });
    expect(await repository.loadDocumentSource("no-existe")).toBeNull();
  });

  /* Va al final: marca como manuales todas las pendientes que quedan (b, c y,
     sin referencia externa, ninguna más) y comprueba que el emisor ya no las ve. */
  it("la migración de corte deja fuera del emisor lo anterior a Migo, sin tocar autorizadas ni enviadas", async () => {
    await invoice("f");
    await invoice("h", "FAC-TX-760444e5-0b64-4c9c-a53d-3d9d462ece3c");
    await repository.markSubmitted({ invoiceId: "fac-inv-f", issuer: "migo", externalReference: "migo-f", fiscalNumber: "001-001-000000009", error: null });
    const migration = readFileSync(join(__dirname, "../prisma/migrations/20261109000000_facturas_anteriores_a_migo/migration.sql"), "utf8");
    // Una sentencia por llamada: el protocolo extendido de PostgreSQL no admite varias.
    const statements = migration.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").split(";").map((sql) => sql.trim()).filter(Boolean);
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);

    const rows = await prisma.invoice.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      "fac-inv-a": "ISSUED", "fac-inv-b": "MANUAL", "fac-inv-c": "MANUAL", "fac-inv-d": "ISSUED", "fac-inv-e": "ISSUED", "fac-inv-f": "ISSUED", "fac-inv-h": "MANUAL",
    });
    // La que AND facturó a mano guarda su número fiscal; las demás manuales, ninguno.
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-h" } })).fiscalNumber).toBe("001-001-000000608");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-b" } })).fiscalNumber).toBeNull();
    // e y f ya están en el proveedor: se siguen consultando. b y c no se emiten nunca.
    const afterClaims = new Date(later.getTime() + 1);
    expect(await repository.listPendingAuthorization(afterClaims, 10)).toEqual(["fac-inv-e", "fac-inv-f"]);
    expect((await repository.claimForAuthorization("fac-inv-b", afterClaims, afterClaims)).kind).toBe("MANUAL");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-b" } })).authorizationClaimedUntil).toBeNull();

    // Una recarga nueva después del corte sí se emite.
    await invoice("g");
    expect(await repository.listPendingAuthorization(afterClaims, 10)).toContain("fac-inv-g");
    expect((await repository.claimForAuthorization("fac-inv-g", afterClaims, later)).kind).toBe("CLAIMED");
  });

  async function invoice(id: string, invoiceNumber = `FAC-TX-FAC-${id}`) {
    const issuedAt = new Date(now.getTime() + id.charCodeAt(0));
    await prisma.rechargeTransaction.create({ data: {
      id: `fac-tx-${id}`, code: `TX-FAC-${id}`, idempotencyKey: `fac-${id}`, clientId: "fac-client", accountId: "fac-account",
      accountTypeSnapshot: AccountType.POSTPAID, creditDaysSnapshot: 30, rechargeStatus: TransactionRechargeStatus.COMPLETED,
      pautaAmount: 25, isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06, completedAt: issuedAt,
      details: { create: { id: `fac-${id}-detail`, pautaId: "fac-meta", platformSnapshot: AdvertisingPlatform.META, requestedAmount: 25,
        isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06, status: TransactionDetailStatus.COMPLETED } },
      invoice: { create: { id: `fac-inv-${id}`, invoiceNumber, status: "ISSUED", issuedAt,
        pautaSubtotal: 25, isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06 } },
    } });
  }
});
