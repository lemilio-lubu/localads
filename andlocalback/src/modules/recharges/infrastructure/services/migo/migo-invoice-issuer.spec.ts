import { describe, expect, it, vi } from "vitest";
import { InvoiceAuthorizationRequest } from "../../../application/ports/invoice-issuer.ports";
import { MonetaryAmount } from "../../../domain/value-objects/monetary-amount";
import { MigoApiError } from "./migo-api.client";
import { MigoInvoiceResponse } from "./migo-api.types";
import { MigoGateway, MigoInvoiceIssuer, MigoIssuerSettings } from "./migo-invoice-issuer";
import { migoInvoiceUuid } from "./migo-invoice.mapper";

const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const now = new Date("2026-11-07T16:00:00.000Z");
const request: InvoiceAuthorizationRequest = {
  invoiceId: "invoice-1",
  invoiceNumber: "FAC-TX-1",
  transactionCode: "TX-1",
  issuedAt: new Date("2026-11-07T15:00:00.000Z"),
  customer: { name: "Cliente Uno S.A.", ruc: "1790012345001", email: "uno@example.test" },
  lines: [{ platform: "META", description: "Recarga publicitaria Meta", amount: money("25.00"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") }],
  totals: { pautaAmount: money("25.00"), isdAmount: money("1.25"), agencyFeeAmount: money("2.50"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") },
  payment: { mode: "PREPAID", creditDays: null },
  externalReference: null,
};
const settings: MigoIssuerSettings = {
  emissionPointId: 239, products: { META: { id: 6644066, code: "05" } }, vatTaxId: 4, vendorId: null, activityId: null, payments: null,
  rucIdentificationTypeId: 1, customerGroupId: 2,
};
const accessKey = "0711202601179001234500120010010000001231234567811";
const migoInvoice = (overrides: Partial<MigoInvoiceResponse> = {}): MigoInvoiceResponse => ({ id: 4521, number: "001-001-000000123", status: "SENT_TO_SRI", ...overrides });

function gateway(overrides: Partial<MigoGateway> = {}) {
  return {
    findCustomerByIdentification: vi.fn(async () => ({ id: 7, socialReason: "Cliente Uno S.A.", identificationNumber: "1790012345001", active: true })),
    createCustomer: vi.fn(async () => ({ id: 8, socialReason: "Cliente Uno S.A.", identificationNumber: "1790012345001", active: true })),
    createInvoice: vi.fn(async () => migoInvoice()),
    getInvoice: vi.fn(async () => migoInvoice()),
    ...overrides,
  } satisfies MigoGateway;
}

describe("emisor de facturas Migo", () => {
  it("emite con el cliente existente y, si el SRI aún no responde, devuelve la referencia para consultarla", async () => {
    const migo = gateway();
    const issuance = await new MigoInvoiceIssuer(migo, settings, () => now).authorize(request);
    expect(issuance).toEqual({ status: "SUBMITTED", externalReference: "4521", fiscalNumber: "001-001-000000123" });
    expect(migo.findCustomerByIdentification).toHaveBeenCalledWith("1790012345001");
    expect(migo.createCustomer).not.toHaveBeenCalled();
    expect(migo.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoiceUuid: migoInvoiceUuid("FAC-TX-1"), customer: expect.objectContaining({ id: 7 }), totalAmount: 33.06 }));
  });

  it("si Migo la autoriza al momento, devuelve la clave de autorización, el número fiscal y la referencia", async () => {
    const migo = gateway({ createInvoice: vi.fn(async () => migoInvoice({ status: "AUTHORIZED", authorizationKey: accessKey, accessKey })) });
    expect(await new MigoInvoiceIssuer(migo, settings, () => now).authorize(request)).toEqual({
      status: "AUTHORIZED",
      authorization: { authorizationNumber: accessKey, authorizedAt: now, fiscalNumber: "001-001-000000123" },
      externalReference: "4521",
    });
  });

  it("con referencia previa solo consulta esa factura: nunca emite otra", async () => {
    const migo = gateway({ getInvoice: vi.fn(async () => migoInvoice({ status: "AUTHORIZED", accessKey })) });
    const issuance = await new MigoInvoiceIssuer(migo, settings, () => now).authorize({ ...request, externalReference: "4521" });
    expect(migo.getInvoice).toHaveBeenCalledWith("4521");
    expect(migo.createInvoice).not.toHaveBeenCalled();
    expect(migo.findCustomerByIdentification).not.toHaveBeenCalled();
    expect(issuance).toMatchObject({ status: "AUTHORIZED", authorization: { authorizationNumber: accessKey } });
  });

  it("estados intermedios y autorizada sin clave todavía: sigue pendiente", async () => {
    for (const invoice of [migoInvoice({ status: "CREATED" }), migoInvoice({ status: "SENT" }), migoInvoice({ status: "AUTHORIZED", authorizationKey: " ", accessKey: null })]) {
      const issuance = await new MigoInvoiceIssuer(gateway({ getInvoice: vi.fn(async () => invoice) }), settings, () => now).authorize({ ...request, externalReference: "4521" });
      expect(issuance.status).toBe("SUBMITTED");
    }
  });

  it("rechazada por el SRI, con error o anulada: guarda la referencia y explica el motivo", async () => {
    const cases: [MigoInvoiceResponse, string][] = [
      [migoInvoice({ status: "NOT_AUTHORIZED", sriMessage: "IDENTIFICACION DEL COMPRADOR INVALIDA" }), "El SRI no autorizó la factura: IDENTIFICACION DEL COMPRADOR INVALIDA"],
      [migoInvoice({ status: "ERROR", messages: ["Firma vencida", ""] }), "Migo reportó un error al enviarla al SRI: Firma vencida"],
      [migoInvoice({ status: "NOT_AUTHORIZED" }), "El SRI no autorizó la factura"],
      [migoInvoice({ status: "VOIDED" }), "La factura fue anulada en Migo"],
    ];
    for (const [invoice, reason] of cases) {
      const issuance = await new MigoInvoiceIssuer(gateway({ getInvoice: vi.fn(async () => invoice) }), settings, () => now).authorize({ ...request, externalReference: "4521" });
      expect(issuance).toEqual({ status: "REJECTED", externalReference: "4521", fiscalNumber: "001-001-000000123", reason });
    }
  });

  it("da de alta en Migo al cliente que no existe, con RUC, grupo, razón social y correo", async () => {
    const migo = gateway({ findCustomerByIdentification: vi.fn(async () => null) });
    await new MigoInvoiceIssuer(migo, settings, () => now).authorize(request);
    expect(migo.createCustomer).toHaveBeenCalledWith({ identificationNumber: "1790012345001", identificationTypeId: 1, customerGroupId: 2, socialReason: "Cliente Uno S.A.", email: "uno@example.test" });
    expect(migo.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ customer: expect.objectContaining({ id: 8 }) }));
  });

  it("si otro proceso dio de alta al cliente a la vez, lo vuelve a buscar en vez de fallar", async () => {
    const find = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9, socialReason: "X", identificationNumber: "1790012345001", active: true });
    const migo = gateway({ findCustomerByIdentification: find, createCustomer: vi.fn(async () => { throw new MigoApiError(422, "UNPROCESSABLE_ENTITY", "ya existe"); }) });
    await new MigoInvoiceIssuer(migo, settings, () => now).authorize(request);
    expect(migo.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ customer: expect.objectContaining({ id: 9 }) }));
  });

  it("propaga los errores de Migo y de mapeo sin emitir nada: el caso de uso los deja pendientes", async () => {
    const down = gateway({ createInvoice: vi.fn(async () => { throw new MigoApiError(0, null, "No se pudo conectar con Migo: ECONNREFUSED"); }) });
    await expect(new MigoInvoiceIssuer(down, settings).authorize(request)).rejects.toThrow(/ECONNREFUSED/);
    const forbidden = gateway({ createCustomer: vi.fn(async () => { throw new MigoApiError(403, "FORBIDDEN", "sin permiso CUSTOMER:CREATE"); }), findCustomerByIdentification: vi.fn(async () => null) });
    await expect(new MigoInvoiceIssuer(forbidden, settings).authorize(request)).rejects.toMatchObject({ status: 403 });
    const noRuc = gateway();
    await expect(new MigoInvoiceIssuer(noRuc, settings).authorize({ ...request, customer: { ...request.customer, ruc: null } })).rejects.toThrow(/no tiene RUC/);
    expect(noRuc.createInvoice).not.toHaveBeenCalled();
  });

  it("el PDF lleva el número fiscal y la autorización del SRI, sin la marca de prueba", async () => {
    const issuer = new MigoInvoiceIssuer(gateway(), settings, () => now);
    const document = await issuer.document(request, { authorizationNumber: accessKey, authorizedAt: now, fiscalNumber: "001-001-000000123" });
    const text = Buffer.from(document.content).toString("latin1");
    expect(document.mimeType).toBe("application/pdf");
    for (const expected of ["Factura electrónica autorizada por el SRI", "Número: 001-001-000000123", `Autorización SRI: ${accessKey}`, "US$ 33.06"]) expect(text).toContain(expected);
    expect(text).not.toContain("SIN VALIDEZ");
  });
});
