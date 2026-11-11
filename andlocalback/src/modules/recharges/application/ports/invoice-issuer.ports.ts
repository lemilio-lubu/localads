import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";

/**
 * Emisión fiscal de la factura ante el proveedor (Migo, que la autoriza en
 * el SRI). La factura interna se crea al completar la recarga; autorizarla es
 * un paso aparte, fuera de la transacción de base de datos, para que un fallo
 * o una demora del proveedor no bloquee la operación del equipo.
 */
/* Una línea por plataforma. `amount` es la pauta; base, IVA y total son los
   que calculó AndPricingPolicy para esa plataforma y ya se cobraron: el
   emisor no recalcula nada. */
export type InvoiceLine = Readonly<{
  /* META, GOOGLE, TIKTOK: el proveedor factura cada una con su producto. */
  platform: string;
  description: string;
  amount: MonetaryAmount;
  vatBaseAmount: MonetaryAmount;
  vatAmount: MonetaryAmount;
  totalAmount: MonetaryAmount;
}>;

export type InvoicePaymentMode = "PREPAID" | "POSTPAID";

export type InvoiceAuthorizationRequest = Readonly<{
  invoiceId: string;
  /* Número interno, único: el adaptador real debe usarlo como clave de
     idempotencia ante el proveedor, para no emitir dos veces la misma. */
  invoiceNumber: string;
  transactionCode: string;
  issuedAt: Date;
  /* Dirección y teléfono son opcionales en el cliente; Migo los exige al dar
     de alta a uno nuevo y el emisor pone un valor genérico si faltan. */
  customer: Readonly<{ name: string; ruc: string | null; email: string; address?: string | null; phone?: string | null }>;
  lines: readonly InvoiceLine[];
  payment: Readonly<{ mode: InvoicePaymentMode; creditDays: number | null }>;
  /* Id de la factura en el proveedor, si ya se envió antes. Con él, el
     emisor consulta el estado en vez de emitir otra vez. */
  externalReference: string | null;
  totals: Readonly<{
    pautaAmount: MonetaryAmount;
    isdAmount: MonetaryAmount;
    agencyFeeAmount: MonetaryAmount;
    vatBaseAmount: MonetaryAmount;
    vatAmount: MonetaryAmount;
    totalAmount: MonetaryAmount;
  }>;
}>;

/* fiscalNumber: el número del SRI (001-001-000000123) que asigna el
   proveedor; nulo en el simulado, que no tiene secuencia fiscal. */
export type InvoiceAuthorization = Readonly<{ authorizationNumber: string; authorizedAt: Date; fiscalNumber: string | null }>;

/**
 * Lo que responde el emisor:
 * - AUTHORIZED: el SRI la autorizó.
 * - SUBMITTED: el proveedor la recibió y espera al SRI; se vuelve a consultar.
 * - REJECTED: el SRI o el proveedor la rechazó; necesita revisión humana, pero
 *   se guarda la referencia para no emitir otra igual al reintentar.
 * Un error lanzado significa que no se sabe si llegó: se reintenta igual.
 */
/* issuedAt: la fecha de emisión que registró el proveedor, solo cuando no es
   el día de la factura interna (se emitió otro día por reintentos). Se guarda
   para que la app muestre la misma fecha que el SRI. */
export type InvoiceIssuance =
  | Readonly<{ status: "AUTHORIZED"; authorization: InvoiceAuthorization; externalReference: string | null; issuedAt?: Date | null }>
  | Readonly<{ status: "SUBMITTED"; externalReference: string; fiscalNumber: string | null; issuedAt?: Date | null }>
  | Readonly<{ status: "REJECTED"; externalReference: string; fiscalNumber: string | null; reason: string; issuedAt?: Date | null }>;

export type InvoiceDocument = Readonly<{ content: Uint8Array; mimeType: "application/pdf" }>;

export interface InvoiceIssuer {
  /** Nombre que queda guardado en la factura (simulado, migo…). */
  readonly name: string;
  /** Desactivado: no se intenta emitir y la factura sigue pendiente. */
  readonly enabled: boolean;
  authorize(request: InvoiceAuthorizationRequest): Promise<InvoiceIssuance>;
  document(request: InvoiceAuthorizationRequest, authorization: InvoiceAuthorization): Promise<InvoiceDocument>;
  /** Días de crédito que el proveedor sabe facturar (Migo: sus plazos de
      pago). Sin el método, cualquier número sirve. */
  creditTermDays?(): Promise<readonly number[]>;
}

/* Reservar una factura para autorizarla es atómico: dos procesos (el aviso al
   completar y el reintento periódico) nunca la piden a la vez al proveedor. */
export type InvoiceClaim =
  | Readonly<{ kind: "NOT_FOUND" }>
  | Readonly<{ kind: "ALREADY_AUTHORIZED" }>
  | Readonly<{ kind: "IN_PROGRESS" }>
  /** Facturada a mano por AND (anterior a la facturación electrónica): no se emite. */
  | Readonly<{ kind: "MANUAL" }>
  /** attempts: fallos seguidos que ya lleva (0 si falta el dato). */
  | Readonly<{ kind: "CLAIMED"; request: InvoiceAuthorizationRequest; attempts?: number }>;

/* Una factura que sigue sin autorizar, para que el admin vea por qué. */
export type UnauthorizedInvoice = Readonly<{
  invoiceId: string;
  invoiceNumber: string;
  transactionCode: string;
  clientName: string;
  totalAmount: string;
  createdAt: Date;
  /* Con referencia, el proveedor ya la tiene y se espera al SRI. */
  externalReference: string | null;
  fiscalNumber: string | null;
  reason: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
}>;

export type RetryReset = "RESET" | "NOT_FOUND" | "NOT_PENDING";

export type InvoiceDocumentSource = Readonly<{
  request: InvoiceAuthorizationRequest;
  authorization: InvoiceAuthorization | null;
  owner: Readonly<{ clientId: string; managerId: string | null }>;
}>;

export interface InvoiceAuthorizationPersistencePort {
  claimForAuthorization(invoiceId: string, now: Date, claimUntil: Date): Promise<InvoiceClaim>;
  markAuthorized(command: Readonly<{
    invoiceId: string; issuer: string; authorization: InvoiceAuthorization; externalReference: string | null; documentUrl: string;
    /** Fecha fiscal de emisión, si cambió respecto a la interna. */
    issuedAt?: Date | null;
  }>): Promise<void>;
  /** Enviada o rechazada: guarda la referencia del proveedor y libera la reserva. */
  markSubmitted(command: Readonly<{
    invoiceId: string; issuer: string; externalReference: string; fiscalNumber: string | null; error: string | null;
    issuedAt?: Date | null;
    /** Con error (rechazada): cuenta un fallo y espera hasta esta fecha. */
    nextAttemptAt?: Date | null;
  }>): Promise<void>;
  /** Cuenta un fallo y no la vuelve a ofrecer al barrido hasta nextAttemptAt. */
  releaseAfterFailure(command: Readonly<{ invoiceId: string; reason: string; nextAttemptAt?: Date | null }>): Promise<void>;
  /** Facturas sin autorizar, sin reserva vigente y a las que ya les toca
      reintento, las más antiguas primero. */
  listPendingAuthorization(now: Date, limit: number): Promise<readonly string[]>;
  /** Pone a cero la espera de una factura pendiente (reintento manual). */
  resetAuthorizationRetry(invoiceId: string): Promise<RetryReset>;
  /** Todas las que siguen sin autorizar, con su motivo. */
  listUnauthorized(limit: number): Promise<readonly UnauthorizedInvoice[]>;
  loadDocumentSource(invoiceId: string): Promise<InvoiceDocumentSource | null>;
}

export const INVOICE_ISSUER = Symbol("INVOICE_ISSUER");
export const INVOICE_AUTHORIZATION_PERSISTENCE = Symbol("INVOICE_AUTHORIZATION_PERSISTENCE");
