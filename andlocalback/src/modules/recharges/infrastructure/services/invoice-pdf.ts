import {
  InvoiceAuthorization,
  InvoiceAuthorizationRequest,
  InvoiceDocument,
} from "../../application/ports/invoice-issuer.ports";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { PdfText, simplePdf } from "./simple-pdf";

export type InvoicePdfHeader = Readonly<{
  /* Bajo el título: la marca de prueba del simulado o la leyenda fiscal. */
  subtitle: string;
  numberLabel: string;
  number: string;
  authorizationLabel: string;
}>;

/**
 * PDF de una factura con su detalle y totales. Lo comparten el emisor
 * simulado y el de Migo (cuya API no entrega el RIDE): solo cambia la
 * cabecera.
 */
export function renderInvoicePdf(
  request: InvoiceAuthorizationRequest,
  authorization: InvoiceAuthorization,
  header: InvoicePdfHeader,
): InvoiceDocument {
  const amount = (value: MonetaryAmount) => `US$ ${value.toMajorUnits()}`;
  // Fecha en Ecuador: en UTC, una recarga de las 19:00 salía con el día siguiente.
  const date = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(value);
  const texts: PdfText[] = [
    { x: 50, y: 790, size: 20, text: "FACTURA", bold: true },
    { x: 50, y: 768, size: 10, text: header.subtitle },
    { x: 50, y: 730, size: 11, text: `${header.numberLabel}: ${header.number}` },
    { x: 50, y: 714, size: 11, text: `${header.authorizationLabel}: ${authorization.authorizationNumber}` },
    { x: 50, y: 698, size: 11, text: `Fecha de emisión: ${date(request.issuedAt)}   Autorizada: ${date(authorization.authorizedAt)}` },
    { x: 50, y: 682, size: 11, text: `Transacción: ${request.transactionCode}` },
    { x: 50, y: 650, size: 12, text: "Cliente", bold: true },
    { x: 50, y: 634, size: 11, text: request.customer.name },
    { x: 50, y: 618, size: 11, text: `RUC: ${request.customer.ruc ?? "sin RUC"}   ${request.customer.email}` },
    { x: 50, y: 586, size: 12, text: "Detalle", bold: true },
  ];
  let y = 568;
  for (const line of request.lines) {
    texts.push({ x: 50, y, size: 11, text: line.description }, { x: 420, y, size: 11, text: amount(line.amount) });
    y -= 16;
  }
  y -= 12;
  const { totals } = request;
  for (const [label, value, bold] of [
    ["Monto de pauta", totals.pautaAmount, false], ["ISD", totals.isdAmount, false], ["Comisión agencia", totals.agencyFeeAmount, false],
    ["Base IVA", totals.vatBaseAmount, false], ["IVA", totals.vatAmount, false], ["Total", totals.totalAmount, true],
  ] as const) {
    texts.push({ x: 300, y, size: 11, text: label, bold }, { x: 420, y, size: 11, text: amount(value), bold });
    y -= 16;
  }
  return { content: simplePdf(texts), mimeType: "application/pdf" };
}
