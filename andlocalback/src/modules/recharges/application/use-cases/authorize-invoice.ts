import { ApplicationError } from "../../../../common/errors/application.error";
import { InvoiceAuthorizationPersistencePort, InvoiceIssuer } from "../ports/invoice-issuer.ports";
import { InvoiceRetryPolicy } from "../../domain/policies/invoice-retry.policy";

export type AuthorizeInvoiceCommand = Readonly<{ invoiceId: string }>;
export type AuthorizeInvoiceResult =
  | Readonly<{ status: "AUTHORIZED"; authorizationNumber: string }>
  | Readonly<{ status: "SUBMITTED"; externalReference: string }>
  | Readonly<{ status: "ALREADY_AUTHORIZED" | "IN_PROGRESS" | "MANUAL" | "DISABLED" }>
  /* attempt: fallos seguidos con este; nextAttemptAt: cuándo la retoma el barrido. */
  | Readonly<{ status: "FAILED"; reason: string; invoiceNumber: string; attempt: number; nextAttemptAt: Date }>;

/* Lo que dura la reserva: si el proceso muere a mitad, pasado este tiempo el
   reintento periódico la vuelve a tomar. */
const CLAIM_MS = 5 * 60_000;

/**
 * Pide al emisor (Migo o el simulado) la autorización de una factura ya
 * creada. Es idempotente y seguro con varios procesos: la reserva atómica
 * impide pedir dos veces la misma factura, y un fallo del emisor no se
 * propaga, deja la factura pendiente con su motivo para el siguiente intento.
 *
 * Si el proveedor la recibe pero el SRI aún no responde (o la rechaza), se
 * guarda su referencia: el siguiente intento consulta esa factura en vez de
 * emitir otra.
 *
 * Cada fallo seguido aleja el siguiente intento (InvoiceRetryPolicy): un
 * rechazo por datos no se arregla solo y no hay que pedirlo cada minuto.
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

    const { invoiceNumber } = claim.request;
    const attempt = (claim.attempts ?? 0) + 1;
    const nextAttemptAt = InvoiceRetryPolicy.nextAttemptAt(attempt, at);
    try {
      const issuance = await this.issuer.authorize(claim.request);
      if (issuance.status === "AUTHORIZED") {
        await this.persistence.markAuthorized({
          invoiceId: command.invoiceId,
          issuer: this.issuer.name,
          authorization: issuance.authorization,
          externalReference: issuance.externalReference,
          issuedAt: issuance.issuedAt,
          documentUrl: `/files/invoices/${command.invoiceId}/content`,
        });
        return { status: "AUTHORIZED", authorizationNumber: issuance.authorization.authorizationNumber };
      }
      const rejected = issuance.status === "REJECTED";
      await this.persistence.markSubmitted({
        invoiceId: command.invoiceId,
        issuer: this.issuer.name,
        externalReference: issuance.externalReference,
        fiscalNumber: issuance.fiscalNumber,
        issuedAt: issuance.issuedAt,
        error: rejected ? issuance.reason : null,
        ...(rejected ? { nextAttemptAt } : {}),
      });
      return rejected
        ? { status: "FAILED", reason: issuance.reason, invoiceNumber, attempt, nextAttemptAt }
        : { status: "SUBMITTED", externalReference: issuance.externalReference };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Error desconocido del emisor";
      await this.persistence.releaseAfterFailure({ invoiceId: command.invoiceId, reason, nextAttemptAt });
      return { status: "FAILED", reason, invoiceNumber, attempt, nextAttemptAt };
    }
  }
}
