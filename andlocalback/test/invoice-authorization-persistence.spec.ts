import { Prisma, PrismaClient } from "@prisma/client";
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
    for (const id of ["a", "b", "c"]) await invoice(id);
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
    expect(claim.request.customer).toEqual({ name: "Cliente Factura", ruc: "1790012345001", email: "factura@example.test" });
    expect(claim.request.lines.map((line) => [line.description, line.amount.toMajorUnits()])).toEqual([["Recarga publicitaria Meta", "25.00"]]);
    expect(claim.request.totals.totalAmount.toMajorUnits()).toBe("33.06");
    expect(claim.request.invoiceNumber).toBe("FAC-TX-FAC-b");
  });

  it("autorizada, guarda número y documento y no se vuelve a reservar", async () => {
    await repository.markAuthorized({ invoiceId: "fac-inv-a", issuer: "simulado", authorization: { authorizationNumber: "SIM-1", authorizedAt: now }, documentUrl: "/files/invoices/fac-inv-a/content" });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-a" } });
    expect(stored).toMatchObject({ authorizationNumber: "SIM-1", issuer: "simulado", documentUrl: "/files/invoices/fac-inv-a/content", authorizationClaimedUntil: null, authorizationError: null });
    expect((await repository.claimForAuthorization("fac-inv-a", later, later)).kind).toBe("ALREADY_AUTHORIZED");
    expect((await repository.claimForAuthorization("no-existe", now, later)).kind).toBe("NOT_FOUND");
  });

  it("un fallo libera la reserva con su motivo y la deja en la lista de pendientes", async () => {
    await repository.releaseAfterFailure({ invoiceId: "fac-inv-b", reason: "Serguéi no responde" });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: "fac-inv-b" } });
    expect(stored).toMatchObject({ authorizationClaimedUntil: null, authorizationError: "Serguéi no responde" });
    // a: autorizada; b: liberada; c: nunca reservada. Una reserva vigente tampoco sale.
    await repository.claimForAuthorization("fac-inv-c", now, later);
    expect(await repository.listPendingAuthorization(now, 10)).toEqual(["fac-inv-b"]);
    expect(await repository.listPendingAuthorization(new Date(later.getTime() + 1), 10)).toEqual(["fac-inv-b", "fac-inv-c"]);
  });

  it("el origen del documento lleva al dueño y la autorización", async () => {
    const source = await repository.loadDocumentSource("fac-inv-a");
    expect(source?.owner).toEqual({ clientId: "fac-client", managerId: null });
    expect(source?.authorization).toEqual({ authorizationNumber: "SIM-1", authorizedAt: now });
    expect(await repository.loadDocumentSource("no-existe")).toBeNull();
  });

  async function invoice(id: string) {
    const issuedAt = new Date(now.getTime() + id.charCodeAt(0));
    await prisma.rechargeTransaction.create({ data: {
      id: `fac-tx-${id}`, code: `TX-FAC-${id}`, idempotencyKey: `fac-${id}`, clientId: "fac-client", accountId: "fac-account",
      accountTypeSnapshot: AccountType.POSTPAID, rechargeStatus: TransactionRechargeStatus.COMPLETED,
      pautaAmount: 25, isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06, completedAt: issuedAt,
      details: { create: { id: `fac-${id}-detail`, pautaId: "fac-meta", platformSnapshot: AdvertisingPlatform.META, requestedAmount: 25,
        isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06, status: TransactionDetailStatus.COMPLETED } },
      invoice: { create: { id: `fac-inv-${id}`, invoiceNumber: `FAC-TX-FAC-${id}`, status: "ISSUED", issuedAt,
        pautaSubtotal: 25, isdAmount: 1.25, agencyFeeAmount: 2.5, vatBaseAmount: 28.75, vatAmount: 4.31, totalAmount: 33.06 } },
    } });
  }
});
