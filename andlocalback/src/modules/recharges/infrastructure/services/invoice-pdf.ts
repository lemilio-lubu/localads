import {
  InvoiceAuthorization,
  InvoiceAuthorizationRequest,
  InvoiceDocument,
} from "../../application/ports/invoice-issuer.ports";
import { AndPricingPolicy } from "../../domain/policies/and-pricing.policy";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { AND_EMITTER, InvoiceEmitter } from "./and-emitter";
import { AND_LOGO, svgPathToPdf } from "./pdf/and-logo";
import { code128Bars } from "./pdf/code128";
import { hex, PAGE_WIDTH, PdfPage, TextStyle } from "./pdf/pdf-page";

export type RideOptions = Readonly<{
  /* Emisor simulado: sin validez tributaria, y el PDF lo dice bien visible. */
  test: boolean;
  /* Código de cada plataforma en el catálogo de Migo (05 Meta, 06 TikTok…). */
  productCode?: (platform: string) => string | null;
  /* Quien firma y envía al SRI; nulo en el simulado. */
  provider: Readonly<{ name: string; ruc: string }> | null;
  emitter?: InvoiceEmitter;
}>;

const INK = hex("#262626");
const MUTED = hex("#717171");
const HEADING = hex("#4f4f4f");
const BORDER = hex("#c9c9c9");
const RULE = hex("#e3e3e3");
/* El azul del RIDE de Migo: la factura que baja del portal se ve como la que
   genera Migo. */
const BLUE = hex("#2e8dcc");
const WHITE = hex("#ffffff");
const WARNING = hex("#b42318");
const LOGO_OPS = svgPathToPdf(AND_LOGO.path);
const VAT_RATE = `${AndPricingPolicy.VAT_RATE_BASIS_POINTS / 100}%`;
const PAYMENT_METHOD = "Otros con utilización del sistema financiero";

const ZONE = "America/Guayaquil";
const part = (value: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-EC", { timeZone: ZONE, ...options }).format(value);
// Fecha en Ecuador: en UTC, una recarga de las 19:00 salía con el día siguiente.
export const rideDate = (value: Date) => part(value, { day: "2-digit", month: "2-digit", year: "numeric" });
const rideTime = (value: Date) => part(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * La clave de acceso del SRI (49 dígitos) lleva dentro la fecha de emisión,
 * el ambiente, el número de la factura y el tipo de emisión. Sin clave válida
 * (el emisor simulado) no hay nada que leer.
 */
export function readAccessKey(key: string): { issueDate: string; environment: string; emission: string; number: string } | null {
  if (!/^\d{49}$/.test(key)) return null;
  return {
    issueDate: `${key.slice(0, 2)}/${key.slice(2, 4)}/${key.slice(4, 8)}`,
    environment: key[23] === "2" ? "PRODUCCIÓN" : "PRUEBAS",
    emission: key[47] === "1" ? "NORMAL" : `Tipo ${key[47]}`,
    number: `${key.slice(24, 27)}-${key.slice(27, 30)}-${key.slice(30, 39)}`,
  };
}

/**
 * RIDE de la factura: la representación impresa de la factura electrónica.
 * Sigue el orden del RIDE de Migo (emisor, factura y clave, cliente, detalle,
 * forma de pago, información adicional y totales) con el logo de AND. Lo
 * comparten el emisor simulado y el de Migo, cuya API no entrega el PDF.
 */
export function renderInvoicePdf(
  request: InvoiceAuthorizationRequest,
  authorization: InvoiceAuthorization,
  options: RideOptions,
): InvoiceDocument {
  const emitter = options.emitter ?? AND_EMITTER;
  const page = new PdfPage();
  const key = authorization.authorizationNumber;
  const parsed = options.test ? null : readAccessKey(key);
  const number = options.test ? request.invoiceNumber : authorization.fiscalNumber ?? parsed?.number ?? request.invoiceNumber;
  const money = (value: MonetaryAmount) => value.toMajorUnits();
  const body = (size = 8.5): TextStyle => ({ size, color: INK });
  const muted = (size = 8.5): TextStyle => ({ size, color: MUTED });
  const margin = 30;
  const right = PAGE_WIDTH - margin;

  /* Emisor y factura, dos cajas iguales. */
  const top = 30;
  const boxHeight = 184;
  const half = (right - margin - 13) / 2;
  const docX = margin + half + 13;
  page.rect(margin, top, half, boxHeight, { stroke: BORDER, radius: 6 });
  page.rect(docX, top, half, boxHeight, { stroke: BORDER, radius: 6 });

  const logoScale = 84 / AND_LOGO.width;
  page.path(margin + 12, top + 12, logoScale, LOGO_OPS, hex(AND_LOGO.color));
  page.text(margin + 12, top + 80, emitter.legalName, { size: 13, font: "bold", color: INK });
  page.text(margin + 12, top + 94, emitter.tradeName, body(9.5));
  [
    `R.U.C.: ${emitter.ruc}`,
    `Matriz: ${emitter.headOffice}`,
    `Sucursal: ${emitter.branch}`,
    `Obligado a llevar contabilidad: ${emitter.keepsAccounting ? "SI" : "NO"}`,
  ].forEach((line, index) => page.text(margin + 12, top + 112 + index * 14, line, body()));
  page.text(margin + 12, top + 168, `Tipo contribuyente: ${emitter.taxpayerType}`, muted());

  const docInner = docX + 12;
  const docWidth = half - 24;
  page.text(docInner, top + 20, "FACTURA", { size: 13, font: "bold", color: INK });
  // El número interno del simulado es largo: se achica para que no salga de la caja.
  const numberText = `No. ${number}`;
  const numberSize = Math.min(11, (11 * docWidth) / page.width(numberText, 11, "bold"));
  page.text(docInner, top + 36, numberText, { size: numberSize, font: "bold", color: INK });
  page.text(docInner, top + 54, "NÚMERO DE AUTORIZACIÓN Y CLAVE DE ACCESO", muted(7));
  page.text(docInner, top + 65, key, { size: 7.6, font: "mono", color: INK });
  if (parsed) {
    const { bars, modules } = code128Bars(key);
    const unit = docWidth / modules;
    for (const [start, width] of bars) page.rect(docInner + start * unit, top + 71, width * unit, 30, { fill: INK });
  } else if (options.test) {
    page.text(docInner, top + 84, "DOCUMENTO DE PRUEBA", { size: 10, font: "bold", color: WARNING });
    page.text(docInner, top + 97, "SIN VALIDEZ TRIBUTARIA", { size: 10, font: "bold", color: WARNING });
  }
  page.text(docInner, top + 118, `Fecha y hora de autorización: ${rideDate(authorization.authorizedAt)} ${rideTime(authorization.authorizedAt)}`, body());
  page.text(docInner, top + 132, `Ambiente: ${options.test ? "PRUEBAS (emisor simulado)" : parsed?.environment ?? "PRODUCCIÓN"}`, body());
  page.text(docInner, top + 146, `Emisión: ${parsed?.emission ?? "NORMAL"}`, body());

  /* Cliente. */
  const clientTop = top + boxHeight + 12;
  const nameLines = page.wrap(request.customer.name, 195, 8.5);
  let y = clientTop + 18;
  page.text(margin + 12, y, "Cliente", muted());
  nameLines.forEach((line, index) => page.text(margin + 90, y + index * 12, line, body()));
  page.text(330, y, "Fecha emisión", muted());
  // La fecha que tiene el SRI: Migo emite con la del día en que se envía,
  // que puede ser posterior a la de la recarga.
  page.text(410, y, parsed?.issueDate ?? rideDate(request.issuedAt), body());
  y += nameLines.length * 12 + 3;
  page.text(margin + 12, y, "RUC / CI", muted());
  page.text(margin + 90, y, request.customer.ruc ?? "—", body());
  page.text(330, y, "Transacción", muted());
  page.text(410, y, request.transactionCode, body());
  const clientBottom = y + 10;
  page.rect(margin, clientTop, right - margin, clientBottom - clientTop, { stroke: BORDER, radius: 6 });

  /* Detalle: una línea por plataforma, como se envió a Migo. */
  const tableTop = clientBottom + 12;
  const columns = { code: 36, quantity: 96, description: 106, unit: 400, vat: 450, discount: 500, total: right - 6 };
  page.rect(margin, tableTop, right - margin, 20, { fill: BLUE });
  const header = (x: number, text: string, align: "left" | "right" = "right") => page.text(x, tableTop + 13, text, { size: 8, color: WHITE, align });
  header(columns.code, "Cód.", "left");
  header(columns.quantity, "Cant.");
  header(columns.description, "Descripción", "left");
  header(columns.unit, "P. unit.");
  header(columns.vat, "IVA");
  header(columns.discount, "Desc.");
  header(columns.total, "Total");
  y = tableTop + 20;
  for (const line of request.lines) {
    const description = page.wrap(line.description, columns.unit - 50 - columns.description, 8.5);
    const baseline = y + 13;
    page.text(columns.code, baseline, options.productCode?.(line.platform) ?? "", body());
    page.text(columns.quantity, baseline, "1.00", { ...body(), align: "right" });
    description.forEach((text, index) => page.text(columns.description, baseline + index * 11, text, body()));
    for (const [x, value] of [[columns.unit, money(line.vatBaseAmount)], [columns.vat, money(line.vatAmount)], [columns.discount, "0.00"], [columns.total, money(line.vatBaseAmount)]] as const) {
      page.text(x, baseline, value, { ...body(), align: "right" });
    }
    y += Math.max(20, 9 + description.length * 11);
    page.line(margin, y, right, y, RULE);
  }

  /* Forma de pago e información adicional, a la izquierda; totales a la derecha. */
  const bottomTop = y + 14;
  const leftWidth = 290;
  const inner = margin + 12;
  const { totals } = request;
  y = bottomTop + 16;
  page.text(inner, y, "FORMA DE PAGO", { size: 7.5, font: "bold", color: HEADING });
  y += 14;
  const method = page.wrap(PAYMENT_METHOD, 170, 8.5);
  method.forEach((text, index) => page.text(inner, y + index * 11, text, body()));
  page.text(margin + leftWidth - 12, y, `US$ ${money(totals.totalAmount)}`, { ...body(), align: "right" });
  y += method.length * 11;
  if (request.payment.mode === "POSTPAID" && request.payment.creditDays) {
    page.text(inner, y, `Plazo: ${request.payment.creditDays} días`, muted());
    y += 11;
  }
  y += 12;
  page.text(inner, y, "INFORMACIÓN ADICIONAL", { size: 7.5, font: "bold", color: HEADING });
  y += 14;
  const extra: [string, string][] = [
    ["E-mail", request.customer.email],
    ["Pauta", `US$ ${money(totals.pautaAmount)}`],
    ["ISD", `US$ ${money(totals.isdAmount)}`],
    ["Comisión de agencia", `US$ ${money(totals.agencyFeeAmount)}`],
  ];
  if (options.provider) extra.push(["Proveedor de facturación electrónica", `${options.provider.name} · RUC ${options.provider.ruc}`]);
  for (const [label, value] of extra) {
    const labels = page.wrap(label, 96, 8.5);
    const values = page.wrap(value, leftWidth - 24 - 106, 8.5);
    labels.forEach((text, index) => page.text(inner, y + index * 11, text, muted()));
    values.forEach((text, index) => page.text(inner + 106, y + index * 11, text, body()));
    y += Math.max(labels.length, values.length) * 11 + 3;
  }
  page.rect(margin, bottomTop, leftWidth, y - bottomTop, { stroke: BORDER, radius: 6 });

  const totalsX = margin + leftWidth + 13;
  const totalsRight = right - 12;
  y = bottomTop + 18;
  for (const [label, value] of [
    [`Subtotal ${VAT_RATE}`, totals.vatBaseAmount],
    ["Subtotal 0%", MonetaryAmount.zero()],
    ["Subtotal sin impuestos", totals.vatBaseAmount],
    ["Descuento", MonetaryAmount.zero()],
    [`IVA ${VAT_RATE}`, totals.vatAmount],
  ] as const) {
    page.text(totalsX + 12, y, label, body());
    page.text(totalsRight, y, money(value), { ...body(), align: "right" });
    y += 15;
  }
  page.line(totalsX + 12, y - 6, totalsRight, y - 6, INK);
  y += 8;
  page.text(totalsX + 12, y, "VALOR TOTAL USD", { size: 10, font: "bold", color: INK });
  page.text(totalsRight, y, money(totals.totalAmount), { size: 10, font: "bold", color: INK, align: "right" });
  page.rect(totalsX, bottomTop, right - totalsX, y + 12 - bottomTop, { stroke: BORDER, radius: 6 });

  page.text(PAGE_WIDTH / 2, 812, options.test
    ? "Documento de prueba generado por el emisor simulado. No tiene validez tributaria."
    : "Representación impresa del documento electrónico (RIDE) autorizado por el SRI. Consulte su validez en srienlinea.sri.gob.ec", { ...muted(7), align: "center" });

  return { content: page.toBytes(), mimeType: "application/pdf" };
}
