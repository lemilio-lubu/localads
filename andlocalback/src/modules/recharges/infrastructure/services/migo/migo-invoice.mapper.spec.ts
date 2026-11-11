import { describe, expect, it } from "vitest";
import { InvoiceAuthorizationRequest, InvoiceLine } from "../../../application/ports/invoice-issuer.ports";
import { AndPricingPolicy } from "../../../domain/policies/and-pricing.policy";
import { MonetaryAmount } from "../../../domain/value-objects/monetary-amount";
import { MigoInvoiceRequest } from "./migo-api.types";
import { buildMigoInvoice, migoInvoiceUuid, MigoInvoiceSettings, MigoMappingError, uuidV5 } from "./migo-invoice.mapper";

const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const pricing = new AndPricingPolicy();

const settings: MigoInvoiceSettings = {
  emissionPointId: 239,
  products: { META: { id: 6644066, code: "05" }, GOOGLE: { id: 6644062, code: "04" }, TIKTOK: { id: 6644068, code: "06" } },
  vatTaxId: 4,
  vendorId: null,
  activityId: null,
  payments: { prepaidMethodId: 3, creditMethodId: 7 },
};

/* Una factura como la arma el repositorio: cada línea con el desglose que
   calculó AndPricingPolicy y los totales como suma de las líneas. */
function invoiceFor(pautas: Record<string, string>, overrides: Partial<InvoiceAuthorizationRequest> = {}): InvoiceAuthorizationRequest {
  const lines: InvoiceLine[] = Object.entries(pautas).map(([platform, value]) => {
    const breakdown = pricing.calculate(money(value));
    return {
      platform,
      description: `Recarga publicitaria ${platform}`,
      amount: breakdown.pautaAmount,
      vatBaseAmount: breakdown.vatBaseAmount,
      vatAmount: breakdown.vatAmount,
      totalAmount: breakdown.totalAmount,
    };
  });
  const sum = (pick: (breakdown: ReturnType<AndPricingPolicy["calculate"]>) => MonetaryAmount) =>
    Object.values(pautas).map((value) => pick(pricing.calculate(money(value)))).reduce((total, value) => total.add(value), MonetaryAmount.zero());
  return {
    invoiceId: "invoice-1",
    invoiceNumber: "FAC-TX-1",
    transactionCode: "TX-1",
    issuedAt: new Date("2026-11-07T15:00:00.000Z"),
    customer: { name: "Comercializadora Año Ñandú S.A.", ruc: "1790012345001", email: "pagos@example.test" },
    lines,
    totals: {
      pautaAmount: sum((b) => b.pautaAmount),
      isdAmount: sum((b) => b.isdAmount),
      agencyFeeAmount: sum((b) => b.agencyCommissionAmount),
      vatBaseAmount: sum((b) => b.vatBaseAmount),
      vatAmount: sum((b) => b.vatAmount),
      totalAmount: sum((b) => b.totalAmount),
    },
    payment: { mode: "PREPAID", creditDays: null },
    externalReference: null,
    ...overrides,
  };
}

/* Lo que hace Migo al recibirla, según su contrato: recalcula el IVA de cada
   línea sobre su subtotal (redondeo a centavos, mitad hacia arriba) y suma.
   Si algo no cuadra responde 422 TOTALS_MISMATCH. */
function migoTotalsMismatch(invoice: MigoInvoiceRequest): string[] {
  const cents = (value: number) => {
    const result = Math.round(value * 100);
    if (Math.abs(result / 100 - value) > 1e-9) throw new Error(`${value} tiene más de dos decimales`);
    return result;
  };
  const problems: string[] = [];
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  invoice.details.forEach((line, index) => {
    const lineSubtotal = cents(line.quantity * line.priceUnit) - cents(line.discountAmount);
    const lineTax = Math.floor((lineSubtotal * line.tax.rate + 50) / 100);
    if (lineSubtotal !== cents(line.subtotalAmount)) problems.push(`línea ${index + 1}: subtotal`);
    if (lineTax !== cents(line.taxAmount)) problems.push(`línea ${index + 1}: IVA ${line.taxAmount}, esperado ${lineTax / 100}`);
    if (lineSubtotal + lineTax !== cents(line.totalAmount)) problems.push(`línea ${index + 1}: total`);
    subtotal += lineSubtotal;
    tax += lineTax;
    total += lineSubtotal + lineTax;
  });
  if (subtotal !== cents(invoice.subtotalAmount)) problems.push("subtotal de la factura");
  if (tax !== cents(invoice.taxAmount)) problems.push("IVA de la factura");
  if (total !== cents(invoice.totalAmount)) problems.push("total de la factura");
  return problems;
}

/* Enviada el mismo día que la recarga, salvo que el caso diga otra cosa. */
const SENT_AT = new Date("2026-11-07T16:00:00.000Z");
const build = (request: InvoiceAuthorizationRequest, customerId: number, invoiceSettings: MigoInvoiceSettings, creditTermId: number | null = null, sentAt = SENT_AT) =>
  buildMigoInvoice(request, customerId, invoiceSettings, { creditTermId, sentAt });

describe("UUID de la factura ante Migo", () => {
  it("sigue el RFC 4122 v5 (vector de prueba conocido)", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("es el mismo para la misma factura y distinto para otra: un reintento no emite dos veces", () => {
    expect(migoInvoiceUuid("FAC-TX-1")).toBe(migoInvoiceUuid("FAC-TX-1"));
    expect(migoInvoiceUuid("FAC-TX-1")).not.toBe(migoInvoiceUuid("FAC-TX-2"));
    expect(migoInvoiceUuid("FAC-TX-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("factura de localads → InvoiceRequest de Migo", () => {
  it("una línea por plataforma con la base completa y su IVA, y los totales cobrados", () => {
    const request = invoiceFor({ META: "25.00", TIKTOK: "10.10" });
    expect(build(request, 1532, settings)).toEqual({
      documentType: "INVOICE",
      invoiceUuid: migoInvoiceUuid("FAC-TX-1"),
      issueDate: "2026-11-07",
      emissionPointId: 239,
      subtotalAmount: 40.37,
      taxAmount: 6.05,
      totalAmount: 46.42,
      tipAmount: 0,
      observation: "Recarga TX-1 · FAC-TX-1",
      customer: { id: 1532, identificationNumber: "1790012345001", socialReason: "Comercializadora Año Ñandú S.A." },
      details: [
        { product: { id: 6644066 }, referenceCode: "05", description: "Servicio de Intermediación por Pauta Meta", quantity: 1, priceUnit: 28.75,
          discountAmount: 0, subtotalAmount: 28.75, taxAmount: 4.31, iceAmount: 0, totalAmount: 33.06, tax: { id: 4, rate: 15 } },
        { product: { id: 6644068 }, referenceCode: "06", description: "Servicio de Intermediación por Pauta TikTok", quantity: 1, priceUnit: 11.62,
          discountAmount: 0, subtotalAmount: 11.62, taxAmount: 1.74, iceAmount: 0, totalAmount: 13.36, tax: { id: 4, rate: 15 } },
      ],
      payments: [{ amount: 46.42, paymentMethod: { id: 3 } }],
      additionalInfo: [
        { label: "Transacción", value: "TX-1" },
        { label: "Pauta", value: "US$ 35.10" },
        { label: "ISD", value: "US$ 1.76" },
        { label: "Comisión de agencia", value: "US$ 3.51" },
      ],
    });
  });

  it("cuadra con el recálculo de Migo en cualquier monto y combinación de plataformas", () => {
    // Barrido de pautas de 0.01 a 100.00 y combinaciones de dos y tres
    // plataformas con centavos «difíciles» (donde el IVA cae en x.xx5).
    const amounts: string[] = [];
    for (let cents = 1; cents <= 10_000; cents += 7) amounts.push((cents / 100).toFixed(2));
    amounts.push("10.10", "33.33", "999999.99", "1234567.89");
    for (const value of amounts) {
      expect(migoTotalsMismatch(build(invoiceFor({ META: value }), 1, settings)), value).toEqual([]);
    }
    for (let index = 0; index + 2 < amounts.length; index += 13) {
      const request = invoiceFor({ META: amounts[index], GOOGLE: amounts[index + 1], TIKTOK: amounts[index + 2] });
      expect(migoTotalsMismatch(build(request, 1, settings)), amounts.slice(index, index + 3).join("+")).toEqual([]);
    }
  });

  it("pospago: forma de pago a crédito con el plazo elegido; sin plazo no la envía (Migo la rechazaría)", () => {
    const postpaid = invoiceFor({ META: "25.00" }, { payment: { mode: "POSTPAID", creditDays: 30 } });
    expect(build(postpaid, 1, settings, 21297).payments).toEqual([{ amount: 33.06, paymentMethod: { id: 7 }, paymentTerm: { id: 21297 } }]);
    expect(() => build(postpaid, 1, settings)).toThrow(/es pospago y no tiene plazo de pago de Migo/);
  });

  it("sin vendedor, actividad ni código de producto configurados no los envía", () => {
    const invoice = build(invoiceFor({ META: "25.00" }), 1, { ...settings, products: { META: { id: 6644066, code: null } } });
    expect(invoice.payments).toEqual([{ amount: 33.06, paymentMethod: { id: 3 } }]);
    expect(invoice).not.toHaveProperty("vendorId");
    expect(invoice).not.toHaveProperty("activityId");
    expect(invoice.details[0]).not.toHaveProperty("referenceCode");
    const configured = build(invoiceFor({ META: "25.00" }), 1, { ...settings, vendorId: 12, activityId: 1 });
    expect(configured).toMatchObject({ vendorId: 12, activityId: 1 });
  });

  it("recorta la razón social a los 80 caracteres de Migo y fecha la factura el día del envío, en hora de Ecuador", () => {
    const longName = `${"Distribuidora ".repeat(8)}S.A.`;
    const request = invoiceFor({ META: "25.00" }, { customer: { name: longName, ruc: "1790012345001", email: "x@example.test" }, issuedAt: new Date("2026-11-05T15:00:00.000Z") });
    // 00:30 UTC del 8 son las 19:30 del 7 en Guayaquil.
    const invoice = build(request, 1, settings, null, new Date("2026-11-08T00:30:00.000Z"));
    expect(invoice.customer.socialReason.length).toBeLessThanOrEqual(80);
    expect(longName.startsWith(invoice.customer.socialReason)).toBe(true);
    // No la del 5, cuando se completó la recarga: Migo rechaza fechas pasadas.
    expect(invoice.issueDate).toBe("2026-11-07");
    // Y deja constancia de cuándo fue la recarga.
    expect(invoice.additionalInfo).toContainEqual({ label: "Fecha de la recarga", value: "05/11/2026" });
  });

  it("emitida el mismo día de la recarga no añade la fecha de la recarga", () => {
    expect(build(invoiceFor({ META: "25.00" }), 1, settings).additionalInfo?.map((info) => info.label)).not.toContain("Fecha de la recarga");
  });

  it("usa el producto de cada plataforma, como las facturas que AND ya emite en Migo", () => {
    const invoice = build(invoiceFor({ GOOGLE: "1500.00", TIKTOK: "500.00", META: "200.00" }), 1, settings);
    expect(invoice.details.map((line) => [line.product.id, line.referenceCode, line.description])).toEqual([
      [6644062, "04", "Servicio de Intermediación por Pauta Google"],
      [6644068, "06", "Servicio de Intermediación por Pauta TikTok"],
      [6644066, "05", "Servicio de Intermediación por Pauta Meta"],
    ]);
    // 500 de pauta + 25 de ISD + 50 de comisión = 575 de base, como en las facturas reales.
    expect(invoice.details[1]).toMatchObject({ priceUnit: 575, subtotalAmount: 575, taxAmount: 86.25, totalAmount: 661.25 });
  });

  it("no envía una línea de una plataforma sin producto configurado", () => {
    const onlyMeta = { ...settings, products: { META: settings.products.META } };
    expect(() => build(invoiceFor({ META: "10.00", TIKTOK: "10.00" }), 1, onlyMeta)).toThrow(/no hay producto de Migo configurado para la plataforma TIKTOK/);
  });

  it("no envía una factura sin RUC ni sin líneas", () => {
    expect(() => build(invoiceFor({ META: "25.00" }, { customer: { name: "X", ruc: null, email: "x@example.test" } }), 1, settings)).toThrow(MigoMappingError);
    expect(() => build(invoiceFor({ META: "25.00" }, { lines: [] }), 1, settings)).toThrow(/no tiene líneas/);
  });

  it("no envía una factura cuyas líneas no cuadran con lo cobrado", () => {
    const request = invoiceFor({ META: "25.00" });
    const [line] = request.lines;
    const wrongVat = { ...request, lines: [{ ...line, vatAmount: money("4.32"), totalAmount: money("33.07") }] };
    expect(() => build(wrongVat, 1, settings)).toThrow(/IVA 4.32 no es el 15% de 28.75/);
    const wrongLineTotal = { ...request, lines: [{ ...line, totalAmount: money("33.07") }] };
    expect(() => build(wrongLineTotal, 1, settings)).toThrow(/base más IVA no da el total/);
    const wrongInvoiceTotal = { ...request, totals: { ...request.totals, totalAmount: money("40.00") } };
    expect(() => build(wrongInvoiceTotal, 1, settings)).toThrow(/Descuadre en total: las líneas suman 33.06 y la factura dice 40.00/);
    const missingLine = invoiceFor({ META: "25.00", GOOGLE: "5.00" });
    expect(() => build({ ...missingLine, lines: missingLine.lines.slice(0, 1) }, 1, settings)).toThrow(/Descuadre en base imponible/);
  });
});
