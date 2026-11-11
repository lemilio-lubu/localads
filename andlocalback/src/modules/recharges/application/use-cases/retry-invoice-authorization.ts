import { ApplicationError } from "../../../../common/errors/application.error";
import { InvoiceAuthorizationPersistencePort } from "../ports/invoice-issuer.ports";
import { AuthorizeInvoice, AuthorizeInvoiceResult } from "./authorize-invoice";

/**
 * Reintento manual de una factura pendiente: cuando el admin ya corrigió la
 * causa (un dato del cliente, un plazo en Migo), no tiene por qué esperar a
 * que venza la espera del barrido. Pone la espera a cero y la pide ahora;
 * la reserva de AuthorizeInvoice sigue impidiendo el envío doble.
 */
export class RetryInvoiceAuthorization {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly authorizeInvoice: AuthorizeInvoice,
  ) {}

  async execute(command: Readonly<{ invoiceId: string }>): Promise<AuthorizeInvoiceResult> {
    if (typeof command.invoiceId !== "string" || command.invoiceId.trim().length === 0) {
      throw new ApplicationError("INVOICE_REQUIRED", "La factura es obligatoria");
    }
    const reset = await this.persistence.resetAuthorizationRetry(command.invoiceId);
    if (reset === "NOT_FOUND") throw new ApplicationError("INVOICE_NOT_FOUND", "La factura no existe", 404);
    if (reset === "NOT_PENDING") throw new ApplicationError("INVOICE_NOT_PENDING", "La factura ya está autorizada o no se emite por el sistema", 409);
    return this.authorizeInvoice.execute({ invoiceId: command.invoiceId });
  }
}
