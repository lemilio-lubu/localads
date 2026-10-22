import { describe, expect, it } from "vitest";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { SimulatedInvoiceIssuer } from "./simulated-invoice-issuer";

const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const request = {
  invoiceId: "invoice-1",
  invoiceNumber: "FAC-TX-1",
  transactionCode: "TX-1",
  issuedAt: new Date("2026-10-21T20:00:00.000Z"),
  customer: { name: "Comercializadora Año Ñandú", ruc: "1790012345001", email: "uno@example.test" },
  lines: [{ description: "Recarga publicitaria Meta", amount: money("25.00") }],
  totals: { pautaAmount: money("25.00"), isdAmount: money("1.25"), agencyFeeAmount: money("2.50"), vatBaseAmount: money("28.75"), vatAmount: money("4.31"), totalAmount: money("33.06") },
};

describe("emisor de facturas simulado", () => {
  const issuer = new SimulatedInvoiceIssuer(() => new Date("2026-10-21T21:00:00.000Z"));

  it("autoriza siempre con el mismo número para la misma factura", async () => {
    const first = await issuer.authorize(request);
    const again = await issuer.authorize(request);
    expect(first.authorizationNumber).toMatch(/^SIM-[0-9A-F]{12}$/);
    expect(again.authorizationNumber).toBe(first.authorizationNumber);
    expect((await issuer.authorize({ ...request, invoiceNumber: "FAC-TX-2" })).authorizationNumber).not.toBe(first.authorizationNumber);
  });

  it("genera un PDF válido con número, cliente, tildes y total, marcado como prueba", async () => {
    const authorization = await issuer.authorize(request);
    const document = await issuer.document(request, authorization);
    const text = Buffer.from(document.content).toString("latin1");
    expect(document.mimeType).toBe("application/pdf");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // 20:00 UTC del 21 son las 15:00 del 21 en Guayaquil; 00:30 UTC del 22, aún el 21.
    expect(text).toContain("Fecha de emisión: 2026-10-21");
    const late = Buffer.from((await issuer.document({ ...request, issuedAt: new Date("2026-10-22T00:30:00.000Z") }, authorization)).content).toString("latin1");
    expect(late).toContain("Fecha de emisión: 2026-10-21");
    for (const expected of ["FAC-TX-1", authorization.authorizationNumber, "Comercializadora Año Ñandú", "US$ 33.06", "SIN VALIDEZ TRIBUTARIA"]) {
      expect(text).toContain(expected);
    }
    // La tabla xref apunta al inicio exacto de cada objeto.
    const start = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
  });
});
