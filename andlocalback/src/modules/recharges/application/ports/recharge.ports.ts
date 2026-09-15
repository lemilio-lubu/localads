import { Account } from "../../domain/entities/account";
import { Recharge } from "../../domain/entities/recharge";
import { OcrResult, ReceiptUpload, StoredReceipt, TransactionHistoryEvent } from "../../domain/recharge.types";

export interface AccountRepository { findById(id: string): Promise<Account | null>; save?(account: Account): Promise<void>; }
export interface RechargeRepository { save(recharge: Recharge): Promise<void>; findById(id: string): Promise<Recharge | null>; }
export interface TransactionQueryRepository {
  listByAccount(accountId: string): Promise<Array<ReturnType<Recharge["toPrimitives"]> & { history: TransactionHistoryEvent[] }>>;
  listAll(): Promise<Array<ReturnType<Recharge["toPrimitives"]> & { history: TransactionHistoryEvent[]; client: { id: string; name: string; email: string } }>>;
}
export interface ReceiptProcessor { process(upload: ReceiptUpload): Promise<StoredReceipt>; }
export interface OcrProcessor { process(upload: ReceiptUpload): Promise<OcrResult>; }
export interface IdGenerator { generate(): string; }
export type TransactionRealtimeEvent = {
  change: "CREATED" | "UPDATED";
  transaction: ReturnType<Recharge["toPrimitives"]>;
};
export interface TransactionRealtimePublisher { publish(event: TransactionRealtimeEvent): void; }

export const ACCOUNT_REPOSITORY = Symbol("ACCOUNT_REPOSITORY");
export const RECHARGE_REPOSITORY = Symbol("RECHARGE_REPOSITORY");
export const RECEIPT_PROCESSOR = Symbol("RECEIPT_PROCESSOR");
export const OCR_PROCESSOR = Symbol("OCR_PROCESSOR");
export const TRANSACTION_QUERY_REPOSITORY = Symbol("TRANSACTION_QUERY_REPOSITORY");
export const ID_GENERATOR = Symbol("ID_GENERATOR");
export const TRANSACTION_REALTIME_PUBLISHER = Symbol("TRANSACTION_REALTIME_PUBLISHER");
