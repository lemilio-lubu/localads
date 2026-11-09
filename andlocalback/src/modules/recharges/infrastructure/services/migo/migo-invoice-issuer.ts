import {
  InvoiceAuthorization,
  InvoiceAuthorizationRequest,
  InvoiceDocument,
  InvoiceIssuance,
  InvoiceIssuer,
} from "../../../application/ports/invoice-issuer.ports";
import { MIGO_PROVIDER } from "../and-emitter";
import { renderInvoicePdf } from "../invoice-pdf";
import { MigoApiClient, MigoApiError } from "./migo-api.client";
import { MigoInvoiceResponse } from "./migo-api.types";
import { buildMigoInvoice, MigoInvoiceSettings, MigoMappingError, migoSocialReason } from "./migo-invoice.mapper";

export type MigoIssuerSettings = MigoInvoiceSettings & Readonly<{
  /* Para dar de alta en Migo al cliente que aún no existe. */
  rucIdentificationTypeId: number;
  customerGroupId: number;
}>;

export type MigoGateway = Pick<MigoApiClient, "findCustomerByIdentification" | "createCustomer" | "createInvoice" | "getInvoice">;

/**
 * Emisor real: Migo firma la factura y la envía al SRI. La autorización
 * llega después (SENT_TO_SRI → AUTHORIZED), así que:
 * - sin referencia previa, da de alta al cliente si hace falta y emite;
 * - con referencia, solo consulta el estado de esa factura en Migo.
 * El invoiceUuid derivado del número interno evita emitir dos veces si se
 * pierde la respuesta del POST y hay que reintentar.
 */
export class MigoInvoiceIssuer implements InvoiceIssuer {
  readonly name = "migo";
  readonly enabled = true;

  constructor(
    private readonly migo: MigoGateway,
    private readonly settings: MigoIssuerSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceIssuance> {
    if (request.externalReference) return this.toIssuance(await this.migo.getInvoice(request.externalReference));
    const customerId = await this.customerId(request);
    return this.toIssuance(await this.migo.createInvoice(buildMigoInvoice(request, customerId, this.settings)));
  }

  /* La API de Migo no entrega el RIDE: se genera con los datos fiscales
     reales (número del SRI y clave de acceso) y los códigos de producto que
     se enviaron a Migo. */
  async document(request: InvoiceAuthorizationRequest, authorization: InvoiceAuthorization): Promise<InvoiceDocument> {
    return renderInvoicePdf(request, authorization, {
      test: false,
      productCode: (platform) => this.settings.products[platform]?.code ?? null,
      provider: MIGO_PROVIDER,
    });
  }

  private toIssuance(invoice: MigoInvoiceResponse): InvoiceIssuance {
    const externalReference = String(invoice.id);
    const fiscalNumber = invoice.number?.trim() || null;
    const authorizationNumber = invoice.authorizationKey?.trim() || invoice.accessKey?.trim();
    switch (invoice.status) {
      case "AUTHORIZED":
        // Autorizada sin clave todavía: se espera a la siguiente consulta.
        if (!authorizationNumber) return { status: "SUBMITTED", externalReference, fiscalNumber };
        return { status: "AUTHORIZED", authorization: { authorizationNumber, authorizedAt: this.now(), fiscalNumber }, externalReference };
      case "NOT_AUTHORIZED":
      case "ERROR":
        return { status: "REJECTED", externalReference, fiscalNumber, reason: rejectionReason(invoice) };
      case "VOIDED":
        return { status: "REJECTED", externalReference, fiscalNumber, reason: "La factura fue anulada en Migo" };
      default:
        return { status: "SUBMITTED", externalReference, fiscalNumber };
    }
  }

  private async customerId(request: InvoiceAuthorizationRequest): Promise<number> {
    const ruc = request.customer.ruc;
    if (!ruc) throw new MigoMappingError(`La factura ${request.invoiceNumber} no tiene RUC del cliente`);
    const existing = await this.migo.findCustomerByIdentification(ruc);
    if (existing) return existing.id;
    try {
      const created = await this.migo.createCustomer({
        identificationNumber: ruc,
        identificationTypeId: this.settings.rucIdentificationTypeId,
        customerGroupId: this.settings.customerGroupId,
        socialReason: migoSocialReason(request.customer.name),
        email: request.customer.email,
      });
      return created.id;
    } catch (error) {
      // Otro proceso pudo darlo de alta entre la búsqueda y el alta.
      if (error instanceof MigoApiError && (error.status === 409 || error.status === 422)) {
        const raced = await this.migo.findCustomerByIdentification(ruc);
        if (raced) return raced.id;
      }
      throw error;
    }
  }
}

function rejectionReason(invoice: MigoInvoiceResponse): string {
  const detail = invoice.sriMessage?.trim() || invoice.messages?.filter(Boolean).join("; ") || invoice.sriStatus?.trim();
  const prefix = invoice.status === "NOT_AUTHORIZED" ? "El SRI no autorizó la factura" : "Migo reportó un error al enviarla al SRI";
  return detail ? `${prefix}: ${detail}` : prefix;
}
