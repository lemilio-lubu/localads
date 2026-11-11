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
import { buildMigoInvoice, ecuadorDate, MigoInvoiceSettings, MigoMappingError, migoSocialReason } from "./migo-invoice.mapper";
import { MigoPaymentTermCatalog } from "./migo-payment-terms";

export type MigoIssuerSettings = MigoInvoiceSettings & Readonly<{
  /* Para dar de alta en Migo al cliente que aún no existe. */
  rucIdentificationTypeId: number;
  customerGroupId: number;
}>;

/* Para el cliente que aún no tiene dirección o teléfono en la app: Migo no
   deja darlo de alta sin ellos, y la factura del SRI no los exige. Se
   corrigen en Migo o, para las siguientes altas, en la ficha del cliente. */
export const MIGO_FALLBACK_ADDRESS = "Ecuador";
export const MIGO_FALLBACK_PHONE = "0000000000";

export type MigoGateway = Pick<MigoApiClient, "findCustomerByIdentification" | "createCustomer" | "createInvoice" | "getInvoice" | "listPaymentTerms">;

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
  private readonly paymentTerms: MigoPaymentTermCatalog;

  constructor(
    private readonly migo: MigoGateway,
    private readonly settings: MigoIssuerSettings,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.paymentTerms = new MigoPaymentTermCatalog(migo);
  }

  async authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceIssuance> {
    if (request.externalReference) return this.toIssuance(request, await this.migo.getInvoice(request.externalReference));
    const creditTermId = await this.creditTermId(request);
    const customerId = await this.customerId(request);
    // La fecha se toma justo antes de enviar: Migo rechaza las pasadas.
    const sentAt = this.now();
    return this.toIssuance(request, await this.migo.createInvoice(buildMigoInvoice(request, customerId, this.settings, { creditTermId, sentAt })), sentAt);
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

  creditTermDays(): Promise<readonly number[]> {
    return this.paymentTerms.availableDays();
  }

  private toIssuance(request: InvoiceAuthorizationRequest, invoice: MigoInvoiceResponse, sentAt?: Date): InvoiceIssuance {
    const externalReference = String(invoice.id);
    const fiscalNumber = invoice.number?.trim() || null;
    const authorizationNumber = invoice.authorizationKey?.trim() || invoice.accessKey?.trim();
    // Solo viaja cuando hay que corregir la fecha guardada.
    const fiscalDate = fiscalIssuedAt(request, invoice, sentAt);
    const issued = fiscalDate ? { issuedAt: fiscalDate } : {};
    switch (invoice.status) {
      case "AUTHORIZED":
        // Autorizada sin clave todavía: se espera a la siguiente consulta.
        if (!authorizationNumber) return { status: "SUBMITTED", externalReference, fiscalNumber, ...issued };
        return { status: "AUTHORIZED", authorization: { authorizationNumber, authorizedAt: this.now(), fiscalNumber }, externalReference, ...issued };
      case "NOT_AUTHORIZED":
      case "ERROR":
        return { status: "REJECTED", externalReference, fiscalNumber, reason: rejectionReason(invoice), ...issued };
      case "VOIDED":
        return { status: "REJECTED", externalReference, fiscalNumber, reason: "La factura fue anulada en Migo", ...issued };
      default:
        return { status: "SUBMITTED", externalReference, fiscalNumber, ...issued };
    }
  }

  /* Pospago: el plazo de Migo con los días de crédito que tenía el cliente al
     pedir la recarga, los mismos que imprime el RIDE. */
  private async creditTermId(request: InvoiceAuthorizationRequest): Promise<number | null> {
    if (request.payment.mode !== "POSTPAID") return null;
    const days = request.payment.creditDays;
    if (!days || days <= 0) throw new MigoMappingError(`La factura ${request.invoiceNumber} es pospago y no tiene días de crédito`);
    return this.paymentTerms.termIdFor(days);
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
        address: request.customer.address?.trim() || MIGO_FALLBACK_ADDRESS,
        phone: request.customer.phone?.trim() || MIGO_FALLBACK_PHONE,
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

/* La fecha de emisión que tiene Migo (la que responde o, recién enviada, la
   que se mandó), solo si no es el día de la factura interna. Se guarda a
   mediodía de Ecuador para que ninguna zona horaria la mueva de día. */
function fiscalIssuedAt(request: InvoiceAuthorizationRequest, invoice: MigoInvoiceResponse, sentAt?: Date): Date | null {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(invoice.issueDate ?? "")?.[0] ?? (sentAt ? ecuadorDate(sentAt) : null);
  if (!day || day === ecuadorDate(request.issuedAt)) return null;
  return new Date(`${day}T12:00:00-05:00`);
}

function rejectionReason(invoice: MigoInvoiceResponse): string {
  const detail = invoice.sriMessage?.trim() || invoice.messages?.filter(Boolean).join("; ") || invoice.sriStatus?.trim();
  const prefix = invoice.status === "NOT_AUTHORIZED" ? "El SRI no autorizó la factura" : "Migo reportó un error al enviarla al SRI";
  return detail ? `${prefix}: ${detail}` : prefix;
}
