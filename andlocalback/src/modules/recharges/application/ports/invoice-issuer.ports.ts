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
  | Readonly<{ kind: "CLAIMED"; request: InvoiceAuthorizationRequest }>;

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
  }>): Promise<void>;
  releaseAfterFailure(command: Readonly<{ invoiceId: string; reason: string }>): Promise<void>;
  /** Facturas sin autorizar y sin reserva vigente, las más antiguas primero. */
  listPendingAuthorization(now: Date, limit: number): Promise<readonly string[]>;
  loadDocumentSource(invoiceId: string): Promise<InvoiceDocumentSource | null>;
}

export const INVOICE_ISSUER = Symbol("INVOICE_ISSUER");
export const INVOICE_AUTHORIZATION_PERSISTENCE = Symbol("INVOICE_AUTHORIZATION_PERSISTENCE");
