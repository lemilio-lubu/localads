import { Injectable, Logger } from "@nestjs/common";
import { ProcessTransactionReceiptOcr } from "../use-cases/process-transaction-receipt-ocr";

/** Temporary in-process dispatcher. It keeps OCR outside the HTTP response path. */
@Injectable()
export class TransactionReceiptOcrDispatcher {
  private readonly logger = new Logger(TransactionReceiptOcrDispatcher.name);

  constructor(private readonly processReceiptOcr: ProcessTransactionReceiptOcr) {}

  dispatch(receiptId: string): void {
    setImmediate(() => {
      void this.processReceiptOcr.execute({ receiptId }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Error desconocido";
        this.logger.error(`No fue posible procesar OCR para ${receiptId}: ${message}`);
      });
    });
  }
}
