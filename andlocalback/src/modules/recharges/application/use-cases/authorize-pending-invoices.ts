import { InvoiceAuthorizationPersistencePort, InvoiceIssuer } from "../ports/invoice-issuer.ports";
import { AuthorizeInvoice } from "./authorize-invoice";

const BATCH = 20;

/**
 * Reintento de las facturas que quedaron sin autorizar (el emisor falló o
 * estaba caído al completar la recarga). Una a una: el proveedor es externo y
 * un lote en paralelo solo multiplicaría los rechazos por límite de peticiones.
 */
export class AuthorizePendingInvoices {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly issuer: InvoiceIssuer,
    private readonly authorizeInvoice: AuthorizeInvoice,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<Readonly<{ authorized: number; failed: number }>> {
    if (!this.issuer.enabled) return { authorized: 0, failed: 0 };
    const pending = await this.persistence.listPendingAuthorization(this.now(), BATCH);
    let authorized = 0;
    let failed = 0;
    for (const invoiceId of pending) {
      const result = await this.authorizeInvoice.execute({ invoiceId });
      if (result.status === "AUTHORIZED") authorized++;
      if (result.status === "FAILED") failed++;
    }
    return { authorized, failed };
  }
}
