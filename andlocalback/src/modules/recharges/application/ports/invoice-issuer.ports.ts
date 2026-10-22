import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";

/**
 * Emisión fiscal de la factura ante el proveedor (Serguéi, que la autoriza en
 * el SRI). La factura interna se crea al completar la recarga; autorizarla es
 * un paso aparte, fuera de la transacción de base de datos, para que un fallo
 * o una demora del proveedor no bloquee la operación del equipo.
 */
export type InvoiceAuthorizationRequest = Readonly<{
  invoiceId: string;
  /* Número interno, único: el adaptador real debe usarlo como clave de
     idempotencia ante el proveedor, para no emitir dos veces la misma. */
  invoiceNumber: string;
  transactionCode: string;
  issuedAt: Date;
  customer: Readonly<{ name: string; ruc: string | null; email: string }>;
  lines: readonly Readonly<{ description: string; amount: MonetaryAmount }>[];
  totals: Readonly<{
    pautaAmount: MonetaryAmount;
    isdAmount: MonetaryAmount;
    agencyFeeAmount: MonetaryAmount;
    vatBaseAmount: MonetaryAmount;
    vatAmount: MonetaryAmount;
    totalAmount: MonetaryAmount;
  }>;
}>;

export type InvoiceAuthorization = Readonly<{ authorizationNumber: string; authorizedAt: Date }>;

export type InvoiceDocument = Readonly<{ content: Uint8Array; mimeType: "application/pdf" }>;

export interface InvoiceIssuer {
  /** Nombre que queda guardado en la factura (simulado, sergei…). */
  readonly name: string;
  /** Desactivado: no se intenta emitir y la factura sigue pendiente. */
  readonly enabled: boolean;
  authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceAuthorization>;
  document(request: InvoiceAuthorizationRequest, authorization: InvoiceAuthorization): Promise<InvoiceDocument>;
}

/* Reservar una factura para autorizarla es atómico: dos procesos (el aviso al
   completar y el reintento periódico) nunca la piden a la vez al proveedor. */
export type InvoiceClaim =
  | Readonly<{ kind: "NOT_FOUND" }>
  | Readonly<{ kind: "ALREADY_AUTHORIZED" }>
  | Readonly<{ kind: "IN_PROGRESS" }>
  | Readonly<{ kind: "CLAIMED"; request: InvoiceAuthorizationRequest }>;

export type InvoiceDocumentSource = Readonly<{
  request: InvoiceAuthorizationRequest;
  authorization: InvoiceAuthorization | null;
  owner: Readonly<{ clientId: string; managerId: string | null }>;
}>;

export interface InvoiceAuthorizationPersistencePort {
  claimForAuthorization(invoiceId: string, now: Date, claimUntil: Date): Promise<InvoiceClaim>;
  markAuthorized(command: Readonly<{ invoiceId: string; issuer: string; authorization: InvoiceAuthorization; documentUrl: string }>): Promise<void>;
  releaseAfterFailure(command: Readonly<{ invoiceId: string; reason: string }>): Promise<void>;
  /** Facturas sin autorizar y sin reserva vigente, las más antiguas primero. */
  listPendingAuthorization(now: Date, limit: number): Promise<readonly string[]>;
  loadDocumentSource(invoiceId: string): Promise<InvoiceDocumentSource | null>;
}

export const INVOICE_ISSUER = Symbol("INVOICE_ISSUER");
export const INVOICE_AUTHORIZATION_PERSISTENCE = Symbol("INVOICE_AUTHORIZATION_PERSISTENCE");
