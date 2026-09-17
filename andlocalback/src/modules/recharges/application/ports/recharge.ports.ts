import { OcrResult, ReceiptUpload, StoredReceipt } from "../../domain/recharge.types";

export interface ReceiptProcessor { process(upload: ReceiptUpload): Promise<StoredReceipt>; }
export interface OcrProcessor { process(upload: ReceiptUpload): Promise<OcrResult>; }
export interface IdGenerator { generate(): string; }

export const RECEIPT_PROCESSOR = Symbol("RECEIPT_PROCESSOR");
export const OCR_PROCESSOR = Symbol("OCR_PROCESSOR");
export const ID_GENERATOR = Symbol("ID_GENERATOR");
