import { describe, expect, it } from "vitest";
import { InvoiceAuthorizationRequest } from "../../../application/ports/invoice-issuer.ports";
import { MonetaryAmount } from "../../../domain/value-objects/monetary-amount";
import { AND_EMITTER } from "../and-emitter";
import { readAccessKey, renderInvoicePdf } from "../invoice-pdf";
import { AND_LOGO, svgPathToPdf } from "./and-logo";
import { CODE128_PATTERNS, code128Bars, code128Values } from "./code128";
import { helveticaWidth } from "./helvetica-metrics";
import { PdfPage } from "./pdf-page";

/* Clave real de la factura 001-001-000000664 que AND emitió en Migo. */
const ACCESS_KEY = "0511202601179322409100120010010000006648730124112";
const money = (value: string) => MonetaryAmount.fromMajorUnits(value);
const request: InvoiceAuthorizationRequest = {
  invoiceId: "invoice-1",
  invoiceNumber: "FAC-TX-1",
  transactionCode: "TX-1",
  issuedAt: new Date("2026-11-05T15:00:00.000Z"),
  customer: { name: "Cliente Uno S.A.", ruc: "1790012345001", email: "uno@example.test" },
  lines: [{ platform: "META", description: "Servicio de Intermediación por Pauta Meta", amount: money("800.00"), vatBaseAmount: money("920.00"), vatAmount: money("138.00"), totalAmount: money("1058.00") }],
  totals: { pautaAmount: money("800.00"), isdAmount: money("40.00"), agencyFeeAmount: money("80.00"), vatBaseAmount: money("920.00"), vatAmount: money("138.00"), totalAmount: money("1058.00") },
  payment: { mode: "POSTPAID", creditDays: 30 },
  externalReference: "4521",
};
const pdfText = (content: Uint8Array) => Buffer.from(content).toString("latin1");

describe("Code 128 de la clave de acceso", () => {
  it("cada símbolo son 11 módulos y no hay dos iguales", () => {
    expect(CODE128_PATTERNS).toHaveLength(106);
    for (const pattern of CODE128_PATTERNS) expect([...pattern].reduce((sum, width) => sum + Number(width), 0)).toBe(11);
    expect(new Set(CODE128_PATTERNS).size).toBe(106);
  });

  it("codifica los dígitos de dos en dos con su dígito de control", () => {
    // Inicio C (105), 12, 34 y control (105 + 12·1 + 34·2) mod 103 = 82.
    expect(code128Values("1234")).toEqual([105, 12, 34, 82]);
    // Con un número impar de dígitos, el último va en el juego B (100) como carácter.
    expect(code128Values("123")).toEqual([105, 12, 100, 19, (105 + 12 + 200 + 19 * 3) % 103]);
    expect(() => code128Values("12a4")).toThrow();
  });

  it("la clave de 49 dígitos ocupa inicio, 24 pares, cambio, un dígito, control y parada", () => {
    const { bars, modules } = code128Bars(ACCESS_KEY);
    expect(modules).toBe(11 * (1 + 24 + 2 + 1) + 13);
    // Tres barras por símbolo y cuatro en la parada.
    expect(bars).toHaveLength(3 * 28 + 4);
  });
});

describe("logo vectorial", () => {
  it("traduce los comandos absolutos de un trazado SVG", () => {
    expect(svgPathToPdf("M0 0V10H5L6 7C1 2 3 4 5 6Z")).toBe("0 0 m 0 10 l 5 10 l 6 7 l 1 2 3 4 5 6 c h");
    expect(() => svgPathToPdf("m0 0 l1 1")).toThrow(/no soportado/);
    expect(() => svgPathToPdf("M0")).toThrow(/incompleto/);
  });

  it("el logo de AND se convierte entero", () => {
    const ops = svgPathToPdf(AND_LOGO.path);
    expect(ops.match(/ c/g)?.length).toBe(75);
    expect(ops.match(/ h/g)?.length).toBe(2);
  });
});

describe("clave de acceso del SRI", () => {
  it("de la clave salen la fecha de emisión, el ambiente, el número y el tipo de emisión", () => {
    expect(readAccessKey(ACCESS_KEY)).toEqual({ issueDate: "05/11/2026", environment: "PRODUCCIÓN", emission: "NORMAL", number: "001-001-000000664" });
    expect(readAccessKey(`${ACCESS_KEY.slice(0, 23)}1${ACCESS_KEY.slice(24)}`)?.environment).toBe("PRUEBAS");
    expect(readAccessKey("SIM-1A2B3C4D5E6F")).toBeNull();
  });
});

describe("texto del PDF", () => {
  it("una letra con tilde mide lo mismo que su base", () => {
    expect(helveticaWidth("Año Ñandú", 10, false)).toBe(helveticaWidth("Ano Nandu", 10, false));
    expect(helveticaWidth("Total", 10, true)).toBeGreaterThan(helveticaWidth("Total", 10, false));
  });

  it("parte en líneas que caben, y corta una palabra que sola no cabe", () => {
    const page = new PdfPage();
    const lines = page.wrap("SINERGIAMED INTEGRAL MEDICAL CENTER S.A.S. CON UN NOMBRE MUY LARGO", 120, 8.5);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(page.width(line, 8.5)).toBeLessThanOrEqual(120);
    const cut = page.wrap("x".repeat(80), 50, 8.5);
    expect(cut.join("")).toBe("x".repeat(80));
    for (const line of cut) expect(page.width(line, 8.5)).toBeLessThanOrEqual(50);
  });
});

describe("RIDE", () => {
  it("sin número fiscal guardado lo toma de la clave, y el pospago lleva su plazo", () => {
    const text = pdfText(renderInvoicePdf(request, { authorizationNumber: ACCESS_KEY, authorizedAt: new Date("2026-11-05T20:42:00.000Z"), fiscalNumber: null }, { test: false, provider: null }).content);
    for (const expected of [
      "(No. 001-001-000000664)", `(${AND_EMITTER.legalName})`, `(R.U.C.: ${AND_EMITTER.ruc})`, "(Obligado a llevar contabilidad: SI)",
      // 20:42 UTC son las 15:42 en Ecuador.
      "(Fecha y hora de autorización: 05/11/2026 15:42)", "(Plazo: 30 días)", "(1058.00)", "(US$ 40.00)",
    ]) expect(text).toContain(expected);
  });

  it("la fecha de emisión es la del SRI (la de la clave), no la de la recarga", () => {
    const sentNextDay = `1011${ACCESS_KEY.slice(4)}`;
    const text = pdfText(renderInvoicePdf(request, { authorizationNumber: sentNextDay, authorizedAt: new Date("2026-11-10T15:00:00.000Z"), fiscalNumber: null }, { test: false, provider: null }).content);
    expect(text).toContain("(10/11/2026)");
    expect(text).not.toContain("(05/11/2026)");
  });

  it("el prepago no lleva plazo", () => {
    const text = pdfText(renderInvoicePdf({ ...request, payment: { mode: "PREPAID", creditDays: null } }, { authorizationNumber: ACCESS_KEY, authorizedAt: new Date(), fiscalNumber: null }, { test: false, provider: null }).content);
    expect(text).not.toContain("Plazo");
  });
});
