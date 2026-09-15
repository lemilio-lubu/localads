import { Pauta } from "../../domain/entities/pauta";
import { Payment } from "../../domain/entities/payment";
import { Transaction } from "../../domain/entities/transaction";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import {
  AccountStatus,
  AccountType,
  ClientStatus,
} from "../../domain/recharge.types";
import { PrepaidTransactionView } from "./multi-recharge.ports";

export type PostpaidRechargeContext = Readonly<{
  client: Readonly<{ id: string; status: ClientStatus }> | null;
  account: Readonly<{
    id: string;
    clientId: string;
    status: AccountStatus;
    type: AccountType;
    creditDays: number;
    creditLimit: MonetaryAmount;
    creditUsed: MonetaryAmount;
  }> | null;
  pautas: readonly Pauta[];
}>;

export type PostpaidTransactionView = Omit<PrepaidTransactionView, "receipt">;

export type PostpaidTransactionRecord = Readonly<{
  transaction: Transaction;
  payment: Payment;
}>;

/**
 * Persistence boundary for postpaid recharge requests. savePostpaid must
 * atomically reserve the transaction total as credit and persist the single
 * transaction, all its details and its payment obligation.
 */
export interface PostpaidTransactionPersistencePort {
  loadPostpaidContext(accountId: string): Promise<PostpaidRechargeContext>;
  findPostpaidByIdempotencyKey(clientId: string, idempotencyKey: string): Promise<PostpaidTransactionView | null>;
  savePostpaid(record: PostpaidTransactionRecord): Promise<PostpaidTransactionView>;
  markOverduePayments(asOf: Date): Promise<number>;
}

export const POSTPAID_TRANSACTION_PERSISTENCE = Symbol("POSTPAID_TRANSACTION_PERSISTENCE");
