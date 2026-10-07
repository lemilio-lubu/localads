export const RECEIPT_OBJECT_STORAGE = Symbol("RECEIPT_OBJECT_STORAGE");

export interface ReceiptObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
