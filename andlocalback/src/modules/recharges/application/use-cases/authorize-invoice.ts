import { ApplicationError } from "../../../../common/errors/application.error";
import { InvoiceAuthorizationPersistencePort, InvoiceIssuer } from "../ports/invoice-issuer.ports";

export type AuthorizeInvoiceCommand = Readonly<{ invoiceId: string }>;
export type AuthorizeInvoiceResult =
  | Readonly<{ status: "AUTHORIZED"; authorizationNumber: string }>
  | Readonly<{ status: "ALREADY_AUTHORIZED" | "IN_PROGRESS" | "DISABLED" }>
  | Readonly<{ status: "FAILED"; reason: string }>;

/* Lo que dura la reserva: si el proceso muere a mitad, pasado este tiempo el
   reintento periódico la vuelve a tomar. */
const CLAIM_MS = 5 * 60_000;

/**
 * Pide al emisor (Serguéi o el simulado) la autorización de una factura ya
 * creada. Es idempotente y seguro con varios procesos: la reserva atómica
 * impide pedir dos veces la misma factura, y un fallo del emisor no se
 * propaga, deja la factura pendiente con su motivo para el siguiente intento.
 */
export class AuthorizeInvoice {
  constructor(
    private readonly persistence: InvoiceAuthorizationPersistencePort,
    private readonly issuer: InvoiceIssuer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: AuthorizeInvoiceCommand): Promise<AuthorizeInvoiceResult> {
    if (typeof command.invoiceId !== "string" || command.invoiceId.trim().length === 0) {
      throw new ApplicationError("INVOICE_REQUIRED", "La factura es obligatoria");
    }
    if (!this.issuer.enabled) return { status: "DISABLED" };

    const at = this.now();
    const claim = await this.persistence.claimForAuthorization(command.invoiceId, at, new Date(at.getTime() + CLAIM_MS));
    if (claim.kind === "NOT_FOUND") throw new ApplicationError("INVOICE_NOT_FOUND", "La factura no existe", 404);
    if (claim.kind !== "CLAIMED") return { status: claim.kind };

    try {
      const authorization = await this.issuer.authorize(claim.request);
      await this.persistence.markAuthorized({
        invoiceId: command.invoiceId,
        issuer: this.issuer.name,
        authorization,
        documentUrl: `/files/invoices/${command.invoiceId}/content`,
      });
      return { status: "AUTHORIZED", authorizationNumber: authorization.authorizationNumber };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Error desconocido del emisor";
      await this.persistence.releaseAfterFailure({ invoiceId: command.invoiceId, reason });
      return { status: "FAILED", reason };
    }
  }
}
