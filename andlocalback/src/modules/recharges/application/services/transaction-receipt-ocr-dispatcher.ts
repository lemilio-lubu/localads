import { Injectable, Logger } from "@nestjs/common";
import { ProcessTransactionReceiptOcr } from "../use-cases/process-transaction-receipt-ocr";

/**
 * Lanza el OCR fuera de la respuesta HTTP. Si el proceso muere antes de
 * terminar, `ReceiptOcrRecoveryRunner` lo recoge. Recuerda qué comprobantes
 * está leyendo para que ese barrido no los lea otra vez en paralelo.
 */
@Injectable()
export class TransactionReceiptOcrDispatcher {
  private readonly logger = new Logger(TransactionReceiptOcrDispatcher.name);
  private readonly inFlight = new Set<string>();

  constructor(private readonly processReceiptOcr: ProcessTransactionReceiptOcr) {}

  dispatch(receiptId: string): void {
    this.inFlight.add(receiptId);
    setImmediate(() => {
      void this.processReceiptOcr.execute({ receiptId })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Error desconocido";
          this.logger.error(`No fue posible procesar OCR para ${receiptId}: ${message}`);
        })
        .finally(() => this.inFlight.delete(receiptId));
    });
  }

  isInFlight(receiptId: string): boolean {
    return this.inFlight.has(receiptId);
  }
}
