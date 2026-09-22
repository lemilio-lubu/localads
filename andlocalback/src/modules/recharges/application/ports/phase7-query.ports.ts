import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { AccountType, AdvertisingPlatform, VerificationIssue, VerificationStatus } from "../../domain/recharge.types";

export type PageRequest = Readonly<{ page: number; pageSize: number }>;
export type PageResult<T> = Readonly<{
  items: readonly T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

export type PautaQueryView = Readonly<{
  id: string;
  platform: AdvertisingPlatform;
  externalAccountId: string | null;
  status: PautaStatus;
  currentBalance: number;
  activatedAt: string | null;
  lastRechargeAt: string | null;
}>;

export type WalletOverviewView = Readonly<{
  balanceTotal: number;
  pautas: readonly PautaQueryView[];
}>;

/**
 * Todo lo que el formulario de recarga necesita para que el cliente decida con
 * la informacion a la vista: saldo por pauta, condiciones de credito y las
 * tasas vigentes. Las tasas viajan como dato, no se codifican en el navegador,
 * para que el desglose que se previsualiza sea el mismo que se facturara.
 */
export type RechargeContextView = Readonly<{
  account: Readonly<{
    id: string;
    type: AccountType;
    creditDays: number;
    creditLimit: number;
    creditUsed: number;
    creditAvailable: number;
  }>;
  rates: Readonly<{
    isd: number;
    agencyFee: number;
    vat: number;
  }>;
  pautas: readonly PautaQueryView[];
}>;

export type TransactionListItemView = Readonly<{
  pausedDetails?: number;
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  accountId: string;
  accountTypeSnapshot: AccountType;
  rechargeStatus: TransactionRechargeStatus;
  paymentStatus: TransactionPaymentStatus | null;
  pautaAmount: number;
  totalAmount: number;
  platforms: readonly AdvertisingPlatform[];
  dueDate: string | null;
  createdAt: string;
}>;

export type TransactionDetailQueryView = Readonly<{
  version?: number;
  pausedAt?: string | null;
  pautaStatus?: PautaStatus;
  id: string;
  pautaId: string;
  platform: AdvertisingPlatform;
  externalAccountId: string | null;
  requestedAmount: number;
  isdAmount: number;
  agencyFeeAmount: number;
  vatBaseAmount: number;
  vatAmount: number;
  totalAmount: number;
  effectiveRechargeAmount: number | null;
  status: TransactionDetailStatus;
  effectiveRechargeDate: string | null;
  completedAt: string | null;
}>;

export type PaymentReceiptClientView = Readonly<{
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  status: string;
  createdAt: string;
}>;

export type TransactionPaymentQueryView = Readonly<{
  id: string;
  status: TransactionPaymentStatus;
  expectedAmount: number;
  confirmedAmount: number | null;
  dueDate: string | null;
  confirmedAt: string | null;
  createdAt: string;
  receipts: readonly PaymentReceiptClientView[];
}>;

export type InvoiceQueryView = Readonly<{
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: string;
  pautaSubtotal: number;
  isdAmount: number;
  agencyFeeAmount: number;
  vatBaseAmount: number;
  vatAmount: number;
  totalAmount: number;
  documentUrl: string | null;
}>;

export type ClientTransactionDetailView = Readonly<{
  id: string;
  code: string;
  clientId: string;
  accountId: string;
  accountTypeSnapshot: AccountType;
  creditDaysSnapshot: number | null;
  rechargeStatus: TransactionRechargeStatus;
  pautaAmount: number;
  isdAmount: number;
  agencyFeeAmount: number;
  vatBaseAmount: number;
  vatAmount: number;
  totalAmount: number;
  isdRate: number;
  agencyFeeRate: number;
  vatRate: number;
  completedAt: string | null;
  createdAt: string;
  details: readonly TransactionDetailQueryView[];
  payment: TransactionPaymentQueryView | null;
  invoice: InvoiceQueryView | null;
  verification: Readonly<{
    status: VerificationStatus;
    reviewReason: string | null;
    updatedAt: string;
  }> | null;
}>;

export type OcrResultAdminView = Readonly<{
  id: string;
  bank: string | null;
  detectedAmount: number | null;
  detectedDate: string | null;
  transactionCode: string | null;
  originator: string | null;
  confidence: number | null;
  rawText: string | null;
  failureReason: string | null;
  createdAt: string;
}>;

export type VerificationAdminView = Readonly<{
  id: string;
  status: VerificationStatus;
  requestedPautaAmount: number;
  expectedTransferAmount: number;
  detectedTransferAmount: number | null;
  amountDifference: number | null;
  /** @deprecated Use expectedTransferAmount. */
  expectedAmount: number;
  /** @deprecated Use detectedTransferAmount. */
  detectedAmount: number | null;
  amountMatches: boolean | null;
  issues: readonly VerificationIssue[];
  requiresManualReview: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  reviewReason: string | null;
  rejectionReason: string | null;
  decisionAudit: null | Readonly<{
    previousStatus: string;
    resultingStatus: string;
    decision: "APPROVE" | "REJECT" | "REVIEW";
    administratorUserId: string;
    notes: string | null;
    reviewReason: string | null;
    rejectionReason: string | null;
    createdAt: string;
  }>;
  receipt: PaymentReceiptClientView & Readonly<{ checksum: string }>;
  ocr: OcrResultAdminView | null;
  createdAt: string;
}>;

export type AdminTransactionDetailView = ClientTransactionDetailView & Readonly<{
  clientName: string;
  verifications: readonly VerificationAdminView[];
}>;

/* El cliente filtra su propio historial con los mismos criterios que el admin,
   menos los que no son suyos (clientId va del token, no de la query). */
export type ClientTransactionFilters = PageRequest & Readonly<{
  clientId: string;
  search?: string;
  rechargeStatus?: TransactionRechargeStatus;
  paymentStatus?: TransactionPaymentStatus;
  dateFrom?: Date;
  dateTo?: Date;
}>;

export type AdminTransactionFilters = PageRequest & Readonly<{
  /* Recorte del gestor. Ausente = admin, sin limite. Nunca llega de la query:
     el controller lo toma del token. */
  managerId?: string;
  unassigned?: boolean;
  search?: string;
  clientId?: string;
  accountType?: AccountType;
  rechargeStatus?: TransactionRechargeStatus;
  paymentStatus?: TransactionPaymentStatus;
  dateFrom?: Date;
  dateTo?: Date;
}>;

/* Los totales describen el conjunto filtrado entero, no la pagina devuelta:
   un resumen que solo sumara la pagina contradiria al listado en cuanto
   hubiera mas de una. */
export type TransactionTotals = Readonly<{ pautaAmount: number; totalAmount: number }>;
export type AdminTransactionPage = PageResult<TransactionListItemView> & Readonly<{ totals: TransactionTotals }>;

export type VerificationScope = "ALL" | "REVIEW" | "APPROVED" | "REJECTED";

export type VerificationListItemView = Readonly<{
  id: string;
  transactionId: string;
  transactionCode: string;
  clientId: string;
  clientName: string;
  status: VerificationStatus;
  requestedPautaAmount: number;
  expectedTransferAmount: number;
  detectedTransferAmount: number | null;
  amountDifference: number | null;
  amountMatches: boolean | null;
  bank: string | null;
  bankReference: string | null;
  confidence: number | null;
  issues: readonly VerificationIssue[];
  receiptId: string;
  receiptContentUrl: string;
  receiptMimeType: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /* Nombre del interno que tiene el caso. Con mas de un administrador, dos
     pueden abrir la misma verificacion y ver los dos «En revision» sin saber
     que el otro esta dentro; el dato existia y se tiraba al pintar. */
  decidedByName: string | null;
  reviewReason: string | null;
  createdAt: string;
}>;

export type VerificationFilters = PageRequest & Readonly<{
  managerId?: string;
  unassigned?: boolean;
  scope: VerificationScope;
  status?: VerificationStatus;
  search?: string;
  clientId?: string;
  bank?: string;
  dateFrom?: Date;
  dateTo?: Date;
}>;

/** Read-only boundary. Implementations must scope client detail by clientId in the database query. */
export interface Phase7QueryPort {
  getRechargeContext(clientId: string): Promise<RechargeContextView | null>;
  listPautasByClient(clientId: string): Promise<readonly PautaQueryView[]>;
  listTransactionsByClient(input: ClientTransactionFilters): Promise<PageResult<TransactionListItemView>>;
  findTransactionDetailByClient(input: Readonly<{ transactionId: string; clientId: string }>): Promise<ClientTransactionDetailView | null>;
  listTransactions(input: AdminTransactionFilters): Promise<AdminTransactionPage>;
  findTransactionDetail(transactionId: string, managerId?: string): Promise<AdminTransactionDetailView | null>;
  listVerifications(input: VerificationFilters): Promise<PageResult<VerificationListItemView>>;
}

export const PHASE7_QUERY_PORT = Symbol("PHASE7_QUERY_PORT");
