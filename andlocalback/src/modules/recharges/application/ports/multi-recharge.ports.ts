import { Pauta } from "../../domain/entities/pauta";
import { Payment } from "../../domain/entities/payment";
import { Transaction } from "../../domain/entities/transaction";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
  StoredReceipt,
} from "../../domain/recharge.types";
import {
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";

export type MultiRechargeContext = Readonly<{
  client: Readonly<{ id: string; status: ClientStatus }> | null;
  account: Readonly<{
    id: string;
    clientId: string;
    status: AccountStatus;
    type: AccountType;
  }> | null;
  pautas: readonly Pauta[];
}>;

export type PrepaidTransactionMoneyView = Readonly<{
  pautaAmount: number;
  isdAmount: number;
  agencyCommissionAmount: number;
  vatBaseAmount: number;
  vatAmount: number;
  totalAmount: number;
}>;

export type PrepaidTransactionView = Readonly<{
  id: string;
  code: string;
  idempotencyKey: string;
  clientId: string;
  accountId: string;
  accountTypeSnapshot: AccountType;
  status: TransactionRechargeStatus;
  createdAt: string;
  totals: PrepaidTransactionMoneyView;
  details: readonly Readonly<{
    id: string;
    pautaId: string;
    platform: AdvertisingPlatform;
    externalAccountId: string | null;
    requestedAmount: number;
    isdAmount: number;
    agencyCommissionAmount: number;
    vatBaseAmount: number;
    vatAmount: number;
    totalAmount: number;
    status: TransactionDetailStatus;
    createdAt: string;
  }>[];
  payment: Readonly<{
    id: string;
    transactionId: string;
    accountTypeSnapshot: AccountType;
    status: TransactionPaymentStatus;
    expectedAmount: number;
    confirmedAmount: number | null;
    dueDate: string | null;
    createdAt: string;
  }>;
  receipt: Readonly<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    checksum: string;
    createdAt: string | null;
  }>;
}>;

export type PrepaidTransactionRecord = Readonly<{
  transaction: Transaction;
  payment: Payment;
  receipt: StoredReceipt;
}>;

/**
 * Persistence boundary for the multi-pauta aggregate. savePrepaid must commit
 * transaction, details, payment and receipt metadata in one database transaction.
 */
export interface MultiRechargePersistencePort {
  /** Loads the account, its owning client and that client's pautas. */
  loadContext(accountId: string): Promise<MultiRechargeContext>;
  findByIdempotencyKey(clientId: string, idempotencyKey: string): Promise<PrepaidTransactionView | null>;
  savePrepaid(record: PrepaidTransactionRecord): Promise<PrepaidTransactionView>;
}

export const MULTI_RECHARGE_PERSISTENCE = Symbol("MULTI_RECHARGE_PERSISTENCE");
