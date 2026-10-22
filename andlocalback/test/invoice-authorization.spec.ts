import { describe, expect, it, vi } from "vitest";
import {
  InvoiceAuthorizationPersistencePort,
  InvoiceAuthorizationRequest,
  InvoiceClaim,
  InvoiceDocumentSource,
  InvoiceIssuer,
} from "../src/modules/recharges/application/ports/invoice-issuer.ports";
import { AuthorizeInvoice } from "../src/modules/recharges/application/use-cases/authorize-invoice";
import { GetInvoiceDocument } from "../src/modules/recharges/application/use-cases/get-invoice-document";
import { AuthorizePendingInvoices } from "../src/modules/recharges/application/use-cases/authorize-pending-invoices";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";

const now = new Date("2026-10-21T20:00:00.000Z");
const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const request: InvoiceAuthorizationRequest = {
  invoiceId: "invoice-1",
  invoiceNumber: "FAC-TX-1",
  transactionCode: "TX-1",
  issuedAt: now,
  customer: { name: "Cliente Uno", ruc: "1790012345001", email: "uno@example.test" },
  lines: [{ description: "Recarga Meta", amount: money("25.00") }],
  totals: { pautaAmount: money("25.00"), isdAmount: money("1.25"), agencyFeeAmount: money("2.50"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") },
};
const authorization = { authorizationNumber: "AUT-1", authorizedAt: now };

function persistence(claim: InvoiceClaim, source: InvoiceDocumentSource | null = null) {
  return {
    claimForAuthorization: vi.fn(async () => claim),
    markAuthorized: vi.fn(async () => undefined),
    releaseAfterFailure: vi.fn(async () => undefined),
    listPendingAuthorization: vi.fn(async () => []),
    loadDocumentSource: vi.fn(async () => source),
  } satisfies InvoiceAuthorizationPersistencePort;
}

function issuer(overrides: Partial<InvoiceIssuer> = {}) {
  return {
    name: "simulado",
    enabled: true,
    authorize: vi.fn(async () => authorization),
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
    expect(store.markAuthorized).toHaveBeenCalledWith({ invoiceId: "invoice-1", issuer: "simulado", authorization, documentUrl: "/files/invoices/invoice-1/content" });
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
    expect(result).toEqual({ status: "FAILED", reason: "Serguéi no responde" });
    expect(store.releaseAfterFailure).toHaveBeenCalledWith({ invoiceId: "invoice-1", reason: "Serguéi no responde" });
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
  it("autoriza las pendientes una a una y cuenta las que siguen fallando", async () => {
    const store = { ...persistence({ kind: "CLAIMED", request }), listPendingAuthorization: vi.fn(async () => ["invoice-1", "invoice-2"]) };
    const authorize = { execute: vi.fn(async ({ invoiceId }: { invoiceId: string }) => invoiceId === "invoice-1" ? { status: "AUTHORIZED" as const, authorizationNumber: "A" } : { status: "FAILED" as const, reason: "caído" }) };
    const result = await new AuthorizePendingInvoices(store, issuer(), authorize as never, () => now).execute();
    expect(result).toEqual({ authorized: 1, failed: 1 });
    expect(store.listPendingAuthorization).toHaveBeenCalledWith(now, 20);
  });

  it("con el emisor desactivado ni siquiera consulta la base", async () => {
    const store = persistence({ kind: "NOT_FOUND" });
    expect(await new AuthorizePendingInvoices(store, issuer({ enabled: false }), {} as never, () => now).execute()).toEqual({ authorized: 0, failed: 0 });
    expect(store.listPendingAuthorization).not.toHaveBeenCalled();
  });
});
