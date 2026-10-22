import { createHash } from "node:crypto";
import {
  InvoiceAuthorization,
  InvoiceAuthorizationRequest,
  InvoiceDocument,
  InvoiceIssuer,
} from "../../application/ports/invoice-issuer.ports";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { PdfText, simplePdf } from "./simple-pdf";

/**
 * Emisor de prueba mientras llega la API de Serguéi. Autoriza al instante con
 * un número derivado del de la factura (el mismo siempre: reintentar no crea
 * otro) y genera un PDF marcado como sin validez tributaria. Nunca debe
 * activarse en producción: ver INVOICE_ISSUER en recharges.module.ts.
 */
export class SimulatedInvoiceIssuer implements InvoiceIssuer {
  readonly name = "simulado";
  readonly enabled = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceAuthorization> {
    const digest = createHash("sha256").update(request.invoiceNumber).digest("hex").slice(0, 12).toUpperCase();
    return { authorizationNumber: `SIM-${digest}`, authorizedAt: this.now() };
  }

  async document(request: InvoiceAuthorizationRequest, authorization: InvoiceAuthorization): Promise<InvoiceDocument> {
    const amount = (value: MonetaryAmount) => `US$ ${value.toMajorUnits()}`;
    // Fecha en Ecuador: en UTC, una recarga de las 19:00 salía con el día siguiente.
    const date = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(value);
    const texts: PdfText[] = [
      { x: 50, y: 790, size: 20, text: "FACTURA", bold: true },
      { x: 50, y: 768, size: 10, text: "DOCUMENTO DE PRUEBA - SIN VALIDEZ TRIBUTARIA (emisor simulado)" },
      { x: 50, y: 730, size: 11, text: `Número: ${request.invoiceNumber}` },
      { x: 50, y: 714, size: 11, text: `Autorización: ${authorization.authorizationNumber}` },
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
}

/** Sin emisor configurado: las facturas quedan pendientes de autorizar. */
export class DisabledInvoiceIssuer implements InvoiceIssuer {
  readonly name = "desactivado";
  readonly enabled = false;
  async authorize(): Promise<InvoiceAuthorization> { throw new Error("El emisor de facturas no está configurado"); }
  async document(): Promise<InvoiceDocument> { throw new Error("El emisor de facturas no está configurado"); }
}
