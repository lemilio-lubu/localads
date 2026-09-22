import { TransactionTotals } from "../../domain/entities/transaction";
import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { AccountType } from "../../domain/recharge.types";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";

export type TransactionExecutionDetail = Readonly<{
  pausedAt?: string | null;
  id: string;
  pautaId: string;
  pautaStatus: PautaStatus;
  status: TransactionDetailStatus;
  /* Lo que el cliente pidio recargar. Hace falta en la ejecucion para poder
     comparar: sin esto, el importe efectivo no tenia contra que contrastarse. */
  requestedAmount: MonetaryAmount;
  effectiveAmount: MonetaryAmount | null;
  effectiveRechargeDate: Date | null;
}>;

export type TransactionExecutionContext = Readonly<{
  id: string;
  code: string;
  accountTypeSnapshot: AccountType;
  status: TransactionRechargeStatus;
  version: number;
  paymentStatus: TransactionPaymentStatus;
  details: readonly TransactionExecutionDetail[];
  totals: TransactionTotals;
  completedAt: Date | null;
  invoice: InvoiceView | null;
}>;

export type TransactionExecutionView = Readonly<{
  transactionId: string;
  code: string;
  status: TransactionRechargeStatus;
  completedAt: string | null;
  details: readonly Readonly<{
    id: string;
    pautaId: string;
    status: TransactionDetailStatus;
    effectiveAmount: number | null;
    effectiveRechargeDate: string | null;
  }>[];
}>;

export type CompletedTransactionDetailView = Readonly<{
  transactionId: string;
  detailId: string;
  pautaId: string;
  status: TransactionDetailStatus;
  effectiveAmount: number;
  effectiveRechargeDate: string;
  pautaBalance: number;
}>;

export interface TransactionExecutionPersistencePort {
  loadExecutionContext(transactionId: string): Promise<TransactionExecutionContext | null>;
  startTransaction(transactionId: string, expectedVersion: number, startedAt: Date): Promise<TransactionExecutionView>;
  completeTransactionDetail(command: Readonly<{
    transactionId: string;
    detailId: string;
    effectiveAmount: MonetaryAmount;
    effectiveRechargeDate: Date;
    completedAt: Date;
    /* Queda escrito en el movimiento de saldo. */
    executedBy: string;
  }>): Promise<CompletedTransactionDetailView>;
  /** Completes the transaction and inserts its unique invoice in one database transaction. */
  finalizeTransactionAndIssueInvoice(command: Readonly<{
    transactionId: string;
    expectedVersion: number;
    invoiceId: string;
    completedAt: Date;
  }>): Promise<CompletedTransactionView>;
}

export type InvoiceView = Readonly<{
  id: string;
  transactionId: string;
  number: string;
  status: InvoiceStatus;
  issuedAt: string;
  pautaAmount: number;
  isdAmount: number;
  agencyCommissionAmount: number;
  vatBaseAmount: number;
  vatAmount: number;
  totalAmount: number;
}>;

export type CompletedTransactionView = Readonly<{
  transaction: TransactionExecutionView;
  invoice: InvoiceView;
}>;

export const TRANSACTION_EXECUTION_PERSISTENCE = Symbol("TRANSACTION_EXECUTION_PERSISTENCE");
