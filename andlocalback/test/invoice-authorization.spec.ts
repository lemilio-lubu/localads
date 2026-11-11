import { describe, expect, it, vi } from "vitest";
import {
  InvoiceAuthorizationPersistencePort,
  InvoiceAuthorizationRequest,
  InvoiceClaim,
  InvoiceDocumentSource,
  InvoiceIssuance,
  InvoiceIssuer,
  RetryReset,
  UnauthorizedInvoice,
} from "../src/modules/recharges/application/ports/invoice-issuer.ports";
import { AuthorizeInvoice, AuthorizeInvoiceResult } from "../src/modules/recharges/application/use-cases/authorize-invoice";
import { GetInvoiceDocument } from "../src/modules/recharges/application/use-cases/get-invoice-document";
import { AuthorizePendingInvoices } from "../src/modules/recharges/application/use-cases/authorize-pending-invoices";
import { ListUnauthorizedInvoices } from "../src/modules/recharges/application/use-cases/list-unauthorized-invoices";
import { RetryInvoiceAuthorization } from "../src/modules/recharges/application/use-cases/retry-invoice-authorization";
import { InvoiceRetryPolicy } from "../src/modules/recharges/domain/policies/invoice-retry.policy";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";

const now = new Date("2026-10-21T20:00:00.000Z");
const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const request: InvoiceAuthorizationRequest = {
  invoiceId: "invoice-1",
  invoiceNumber: "FAC-TX-1",
  transactionCode: "TX-1",
  issuedAt: now,
  customer: { name: "Cliente Uno", ruc: "1790012345001", email: "uno@example.test" },
  lines: [{ platform: "META", description: "Recarga Meta", amount: money("25.00"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") }],
  totals: { pautaAmount: money("25.00"), isdAmount: money("1.25"), agencyFeeAmount: money("2.50"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") },
  payment: { mode: "PREPAID", creditDays: null },
  externalReference: null,
};
const minutesLater = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
/* Primer fallo: el barrido la retoma al minuto. */
const firstFailure = { invoiceNumber: "FAC-TX-1", attempt: 1, nextAttemptAt: minutesLater(1) };
const authorization = { authorizationNumber: "AUT-1", authorizedAt: now, fiscalNumber: "001-001-000000001" };
const authorized: InvoiceIssuance = { status: "AUTHORIZED", authorization, externalReference: "4521" };

function persistence(claim: InvoiceClaim, source: InvoiceDocumentSource | null = null) {
  return {
    claimForAuthorization: vi.fn(async () => claim),
    markAuthorized: vi.fn(async () => undefined),
    markSubmitted: vi.fn(async () => undefined),
    releaseAfterFailure: vi.fn(async () => undefined),
    listPendingAuthorization: vi.fn(async () => []),
    resetAuthorizationRetry: vi.fn(async (): Promise<RetryReset> => "RESET"),
    listUnauthorized: vi.fn(async (): Promise<UnauthorizedInvoice[]> => []),
    loadDocumentSource: vi.fn(async () => source),
  } satisfies InvoiceAuthorizationPersistencePort;
}

function issuer(overrides: Partial<InvoiceIssuer> = {}) {
  return {
    name: "simulado",
    enabled: true,
    authorize: vi.fn(async (): Promise<InvoiceIssuance> => authorized),
    document: vi.fn(async () => ({ content: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" as const })),
    ...overrides,
  };
}

describe("autorizar una factura ante el emisor", () => {
  it("la reserva, la autoriza y guarda número, emisor y enlace al documento", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const emitter = issuer();
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "AUTHORIZED", authorizationNumber: "AUT-1" });
    expect(store.claimForAuthorization).toHaveBeenCalledWith("invoice-1", now, new Date(now.getTime() + 5 * 60_000));
    expect(emitter.authorize).toHaveBeenCalledWith(request);
    expect(store.markAuthorized).toHaveBeenCalledWith({
      invoiceId: "invoice-1", issuer: "simulado", authorization, externalReference: "4521", documentUrl: "/files/invoices/invoice-1/content",
    });
    expect(store.markSubmitted).not.toHaveBeenCalled();
  });

  it("si el proveedor la recibió pero el SRI no respondió, guarda su referencia y la deja pendiente", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const emitter = issuer({ authorize: vi.fn(async (): Promise<InvoiceIssuance> => ({ status: "SUBMITTED", externalReference: "4521", fiscalNumber: "001-001-000000001" })) });
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "SUBMITTED", externalReference: "4521" });
    expect(store.markSubmitted).toHaveBeenCalledWith({ invoiceId: "invoice-1", issuer: "simulado", externalReference: "4521", fiscalNumber: "001-001-000000001", error: null });
    expect(store.markAuthorized).not.toHaveBeenCalled();
    expect(store.releaseAfterFailure).not.toHaveBeenCalled();
  });

  it("si el SRI la rechaza, guarda la referencia con el motivo: el reintento la consulta, no emite otra", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const emitter = issuer({ authorize: vi.fn(async (): Promise<InvoiceIssuance> => ({ status: "REJECTED", externalReference: "4521", fiscalNumber: null, reason: "SRI: RUC inexistente" })) });
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "FAILED", reason: "SRI: RUC inexistente", ...firstFailure });
    expect(store.markSubmitted).toHaveBeenCalledWith({ invoiceId: "invoice-1", issuer: "simulado", externalReference: "4521", fiscalNumber: null, error: "SRI: RUC inexistente", nextAttemptAt: minutesLater(1) });
    expect(store.releaseAfterFailure).not.toHaveBeenCalled();
  });

  it("si guardar la referencia falla, libera la reserva para reintentar", async () => {
    const store = { ...persistence({ kind: "CLAIMED", request }), markSubmitted: vi.fn(async () => { throw new Error("base caída"); }) };
    const emitter = issuer({ authorize: vi.fn(async (): Promise<InvoiceIssuance> => ({ status: "SUBMITTED", externalReference: "4521", fiscalNumber: null })) });
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "FAILED", reason: "base caída", ...firstFailure });
    expect(store.releaseAfterFailure).toHaveBeenCalledWith({ invoiceId: "invoice-1", reason: "base caída", nextAttemptAt: minutesLater(1) });
  });

  it("no vuelve a pedir una factura ya autorizada ni una que otro proceso está pidiendo", async () => {
    for (const kind of ["ALREADY_AUTHORIZED", "IN_PROGRESS"] as const) {
      const emitter = issuer();
      const result = await new AuthorizeInvoice(persistence({ kind }), emitter, () => now).execute({ invoiceId: "invoice-1" });
      expect(result.status).toBe(kind);
      expect(emitter.authorize).not.toHaveBeenCalled();
    }
  });

  it("con el emisor desactivado no reserva nada y la factura sigue pendiente", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const result = await new AuthorizeInvoice(store, issuer({ enabled: false }), () => now).execute({ invoiceId: "invoice-1" });
    expect(result.status).toBe("DISABLED");
    expect(store.claimForAuthorization).not.toHaveBeenCalled();
  });

  it("si el emisor falla, libera la reserva con el motivo para reintentarla", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const emitter = issuer({ authorize: vi.fn(async () => { throw new Error("Serguéi no responde"); }) });
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "FAILED", reason: "Serguéi no responde", ...firstFailure });
    expect(store.releaseAfterFailure).toHaveBeenCalledWith({ invoiceId: "invoice-1", reason: "Serguéi no responde", nextAttemptAt: minutesLater(1) });
    expect(store.markAuthorized).not.toHaveBeenCalled();
  });

  it("cada fallo seguido aleja el siguiente intento: 1, 2, 5, 15 y 60 minutos como máximo", async () => {
    expect([1, 2, 3, 4, 5, 6, 40].map((attempt) => (InvoiceRetryPolicy.nextAttemptAt(attempt, now).getTime() - now.getTime()) / 60_000)).toEqual([1, 2, 5, 15, 60, 60, 60]);
    const store = persistence({ kind: "CLAIMED", request, attempts: 3 });
    const emitter = issuer({ authorize: vi.fn(async () => { throw new Error("Migo 422: falta el plazo"); }) });
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "FAILED", reason: "Migo 422: falta el plazo", invoiceNumber: "FAC-TX-1", attempt: 4, nextAttemptAt: minutesLater(15) });
    expect(store.releaseAfterFailure).toHaveBeenCalledWith({ invoiceId: "invoice-1", reason: "Migo 422: falta el plazo", nextAttemptAt: minutesLater(15) });
  });

  it("una factura facturada a mano por AND no se envía al emisor", async () => {
    const store = persistence({ kind: "MANUAL" });
    const emitter = issuer();
    const result = await new AuthorizeInvoice(store, emitter, () => now).execute({ invoiceId: "invoice-1" });
    expect(result).toEqual({ status: "MANUAL" });
    expect(emitter.authorize).not.toHaveBeenCalled();
    expect(store.markAuthorized).not.toHaveBeenCalled();
  });

  it("rechaza una factura inexistente", async () => {
    await expect(new AuthorizeInvoice(persistence({ kind: "NOT_FOUND" }), issuer(), () => now).execute({ invoiceId: "nope" }))
      .rejects.toMatchObject({ code: "INVOICE_NOT_FOUND", status: 404 });
  });

  it("exige el identificador de la factura", async () => {
    await expect(new AuthorizeInvoice(persistence({ kind: "NOT_FOUND" }), issuer(), () => now).execute({ invoiceId: " " }))
      .rejects.toMatchObject({ code: "INVOICE_REQUIRED", status: 400 });
  });
});

describe("abrir el documento de una factura", () => {
  const source: InvoiceDocumentSource = { request, authorization, owner: { clientId: "client-1", managerId: "gestor-1" } };
  const viewer = (role: "ADMIN" | "GESTOR" | "CLIENT", id: string, clientId: string | null = null) => ({ userId: id, role, clientId });

  it("lo entrega a su cliente, a su gestor y a cualquier admin", async () => {
    for (const who of [viewer("CLIENT", "u1", "client-1"), viewer("GESTOR", "gestor-1"), viewer("ADMIN", "admin-1")]) {
      const emitter = issuer();
      const document = await new GetInvoiceDocument(persistence({ kind: "NOT_FOUND" }, source), emitter).execute({ invoiceId: "invoice-1", viewer: who });
      expect(document).toMatchObject({ mimeType: "application/pdf", filename: "FAC-TX-1.pdf" });
      expect(emitter.document).toHaveBeenCalledWith(request, authorization);
    }
  });

  it("responde 404 a otro cliente o a un gestor de otra cartera, sin confirmar que existe", async () => {
    for (const who of [viewer("CLIENT", "u2", "client-2"), viewer("GESTOR", "gestor-2")]) {
      await expect(new GetInvoiceDocument(persistence({ kind: "NOT_FOUND" }, source), issuer()).execute({ invoiceId: "invoice-1", viewer: who }))
        .rejects.toMatchObject({ code: "INVOICE_NOT_FOUND", status: 404 });
    }
  });

  it("avisa si la factura aún no está autorizada", async () => {
    await expect(new GetInvoiceDocument(persistence({ kind: "NOT_FOUND" }, { ...source, authorization: null }), issuer()).execute({ invoiceId: "invoice-1", viewer: viewer("ADMIN", "a") }))
      .rejects.toMatchObject({ code: "INVOICE_NOT_AUTHORIZED", status: 409 });
  });

  it("responde 404 si la factura no existe", async () => {
    await expect(new GetInvoiceDocument(persistence({ kind: "NOT_FOUND" }, null), issuer()).execute({ invoiceId: "x", viewer: viewer("ADMIN", "a") }))
      .rejects.toMatchObject({ code: "INVOICE_NOT_FOUND", status: 404 });
  });
});

describe("reintento de facturas pendientes", () => {
  it("autoriza las pendientes una a una y cuenta las autorizadas, las que esperan al SRI y las que fallan", async () => {
    const store = { ...persistence({ kind: "CLAIMED", request }), listPendingAuthorization: vi.fn(async () => ["invoice-1", "invoice-2", "invoice-3"]) };
    const outcomes: Record<string, AuthorizeInvoiceResult> = {
      "invoice-1": { status: "AUTHORIZED", authorizationNumber: "A" },
      "invoice-2": { status: "FAILED", reason: "caído", invoiceNumber: "FAC-TX-2", attempt: 2, nextAttemptAt: minutesLater(2) },
      "invoice-3": { status: "SUBMITTED", externalReference: "77" },
    };
    const authorize = { execute: vi.fn(async ({ invoiceId }: { invoiceId: string }) => outcomes[invoiceId]) };
    const result = await new AuthorizePendingInvoices(store, issuer(), authorize as never, () => now).execute();
    // Cada fallo viaja con su motivo, para que el log diga qué factura y por qué.
    expect(result).toEqual({ authorized: 1, submitted: 1, failed: 1, failures: [{ invoiceNumber: "FAC-TX-2", reason: "caído", attempt: 2, nextAttemptAt: minutesLater(2) }] });
    expect(store.listPendingAuthorization).toHaveBeenCalledWith(now, 20);
  });

  it("con el emisor desactivado ni siquiera consulta la base", async () => {
    const store = persistence({ kind: "NOT_FOUND" });
    expect(await new AuthorizePendingInvoices(store, issuer({ enabled: false }), {} as never, () => now).execute()).toEqual({ authorized: 0, submitted: 0, failed: 0, failures: [] });
    expect(store.listPendingAuthorization).not.toHaveBeenCalled();
  });
});

describe("reintento manual de una factura", () => {
  it("pone la espera a cero y la pide ahora", async () => {
    const store = persistence({ kind: "CLAIMED", request });
    const authorize = { execute: vi.fn(async (): Promise<AuthorizeInvoiceResult> => ({ status: "SUBMITTED", externalReference: "4521" })) };
    expect(await new RetryInvoiceAuthorization(store, authorize as never).execute({ invoiceId: "invoice-1" })).toEqual({ status: "SUBMITTED", externalReference: "4521" });
    expect(store.resetAuthorizationRetry).toHaveBeenCalledWith("invoice-1");
    expect(authorize.execute).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
  });

  it("rechaza una factura inexistente, una ya autorizada o manual, y un id vacío, sin pedir nada", async () => {
    const authorize = { execute: vi.fn() };
    const missing = { ...persistence({ kind: "NOT_FOUND" }), resetAuthorizationRetry: vi.fn(async (): Promise<RetryReset> => "NOT_FOUND") };
    await expect(new RetryInvoiceAuthorization(missing, authorize as never).execute({ invoiceId: "x" })).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND", status: 404 });
    const done = { ...persistence({ kind: "ALREADY_AUTHORIZED" }), resetAuthorizationRetry: vi.fn(async (): Promise<RetryReset> => "NOT_PENDING") };
    await expect(new RetryInvoiceAuthorization(done, authorize as never).execute({ invoiceId: "invoice-1" })).rejects.toMatchObject({ code: "INVOICE_NOT_PENDING", status: 409 });
    await expect(new RetryInvoiceAuthorization(done, authorize as never).execute({ invoiceId: " " })).rejects.toMatchObject({ code: "INVOICE_REQUIRED" });
    expect(authorize.execute).not.toHaveBeenCalled();
  });
});

describe("facturas sin autorizar para el admin", () => {
  it("dice en qué está cada una: fallando con su motivo, esperando al SRI o en cola", async () => {
    const base = { invoiceNumber: "FAC-1", transactionCode: "TX-1", clientName: "Cliente Uno", totalAmount: "33.06", fiscalNumber: null, attempts: 0, nextAttemptAt: null };
    const store = { ...persistence({ kind: "NOT_FOUND" }), listUnauthorized: vi.fn(async (): Promise<UnauthorizedInvoice[]> => [
      { ...base, invoiceId: "a", createdAt: new Date(now.getTime() - 26 * 3_600_000), externalReference: null, reason: "Migo 422: falta el plazo", attempts: 5, nextAttemptAt: minutesLater(60) },
      { ...base, invoiceId: "b", createdAt: new Date(now.getTime() - 90 * 60_000), externalReference: "4521", fiscalNumber: "001-001-000000677", reason: null },
      { ...base, invoiceId: "c", createdAt: now, externalReference: null, reason: null },
    ]) };
    const result = await new ListUnauthorizedInvoices(store, () => now).execute();
    expect(result.map(({ invoiceId, state, pendingHours }) => ({ invoiceId, state, pendingHours }))).toEqual([
      { invoiceId: "a", state: "FAILING", pendingHours: 26 },
      { invoiceId: "b", state: "WAITING_SRI", pendingHours: 1 },
      { invoiceId: "c", state: "QUEUED", pendingHours: 0 },
    ]);
    expect(result[0]).toMatchObject({ reason: "Migo 422: falta el plazo", attempts: 5, nextAttemptAt: minutesLater(60).toISOString(), clientName: "Cliente Uno", totalAmount: "33.06" });
    expect(result[0]).not.toHaveProperty("externalReference");
    expect(store.listUnauthorized).toHaveBeenCalledWith(100);
  });
});
