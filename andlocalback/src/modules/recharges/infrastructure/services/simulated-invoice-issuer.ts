import { createHash } from "node:crypto";
import {
  InvoiceAuthorization,
  InvoiceAuthorizationRequest,
  InvoiceDocument,
  InvoiceIssuance,
  InvoiceIssuer,
} from "../../application/ports/invoice-issuer.ports";
import { renderInvoicePdf } from "./invoice-pdf";

/**
 * Emisor de prueba para desarrollo. Autoriza al instante con
 * un número derivado del de la factura (el mismo siempre: reintentar no crea
 * otro) y genera un PDF marcado como sin validez tributaria. Nunca debe
 * activarse en producción: ver INVOICE_ISSUER en recharges.module.ts.
 */
export class SimulatedInvoiceIssuer implements InvoiceIssuer {
  readonly name = "simulado";
  readonly enabled = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceIssuance> {
    const digest = createHash("sha256").update(request.invoiceNumber).digest("hex").slice(0, 12).toUpperCase();
    return {
      status: "AUTHORIZED",
      authorization: { authorizationNumber: `SIM-${digest}`, authorizedAt: this.now(), fiscalNumber: null },
      externalReference: null,
    };
  }

  async document(request: InvoiceAuthorizationRequest, authorization: InvoiceAuthorization): Promise<InvoiceDocument> {
    return renderInvoicePdf(request, authorization, {
      subtitle: "DOCUMENTO DE PRUEBA - SIN VALIDEZ TRIBUTARIA (emisor simulado)",
      numberLabel: "Número",
      number: request.invoiceNumber,
      authorizationLabel: "Autorización",
    });
  }
}

/** Sin emisor configurado: las facturas quedan pendientes de autorizar. */
export class DisabledInvoiceIssuer implements InvoiceIssuer {
  readonly name = "desactivado";
  readonly enabled = false;
  async authorize(): Promise<InvoiceIssuance> { throw new Error("El emisor de facturas no está configurado"); }
  async document(): Promise<InvoiceDocument> { throw new Error("El emisor de facturas no está configurado"); }
}
