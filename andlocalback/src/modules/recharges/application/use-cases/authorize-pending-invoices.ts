import { InvoiceAuthorizationPersistencePort, InvoiceIssuer } from "../ports/invoice-issuer.ports";
import { AuthorizeInvoice } from "./authorize-invoice";

const BATCH = 20;

export type InvoiceFailure = Readonly<{ invoiceNumber: string; reason: string; attempt: number; nextAttemptAt: Date }>;

/**
 * Reintento de las facturas que quedaron sin autorizar (el emisor falló,
 * estaba caído al completar la recarga o el SRI aún no respondía). Una a una: el proveedor es externo y
 * un lote en paralelo solo multiplicaría los rechazos por límite de peticiones.
 */
export class AuthorizePendingInvoices {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly issuer: InvoiceIssuer,
    private readonly authorizeInvoice: AuthorizeInvoice,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<Readonly<{ authorized: number; submitted: number; failed: number; failures: readonly InvoiceFailure[] }>> {
    if (!this.issuer.enabled) return { authorized: 0, submitted: 0, failed: 0, failures: [] };
    const pending = await this.persistence.listPendingAuthorization(this.now(), BATCH);
    let authorized = 0;
    let submitted = 0;
    const failures: InvoiceFailure[] = [];
    for (const invoiceId of pending) {
      const result = await this.authorizeInvoice.execute({ invoiceId });
      if (result.status === "AUTHORIZED") authorized++;
      if (result.status === "SUBMITTED") submitted++;
      if (result.status === "FAILED") failures.push({ invoiceNumber: result.invoiceNumber, reason: result.reason, attempt: result.attempt, nextAttemptAt: result.nextAttemptAt });
    }
    return { authorized, submitted, failed: failures.length, failures };
  }
}
