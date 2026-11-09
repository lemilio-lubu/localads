import { TransactionVerificationPersistencePort } from "../ports/transaction-verification.ports";
import { ProcessTransactionReceiptOcr } from "./process-transaction-receipt-ocr";

/** Margen antes de dar un comprobante por perdido: el OCR tarda como mucho 30 s. */
export const UNREAD_RECEIPT_GRACE_MS = 2 * 60_000;
/* Se leen más candidatos de los que se procesan para poder saltar los que
   están en curso o esperando su próximo reintento sin quedarse sin trabajo. */
const CANDIDATES = 20;
const BATCH = 5;

export type RecoverUnreadReceiptsResult = Readonly<{
  recovered: readonly string[];
  failed: readonly Readonly<{ receiptId: string; reason: string }>[];
}>;

/**
 * Lee los comprobantes que se quedaron sin leer. El OCR se lanza fuera de la
 * respuesta HTTP; si el backend se reinicia en ese momento (un despliegue), el
 * comprobante queda en LOADED y nada lo volvía a intentar.
 *
 * Repetir es seguro: `ProcessTransactionReceiptOcr` devuelve la verificación
 * existente si otro proceso ganó, y el guardado reserva el comprobante por
 * versión. Uno a uno, porque Tesseract usa CPU de la API.
 */
export class RecoverUnreadReceipts {
  constructor(
    private readonly persistence: Pick<TransactionVerificationPersistencePort, "listUnreadReceipts">,
    private readonly processReceipt: Pick<ProcessTransactionReceiptOcr, "execute">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(options: Readonly<{ skip?: (receiptId: string) => boolean }> = {}): Promise<RecoverUnreadReceiptsResult> {
    const uploadedBefore = new Date(this.now().getTime() - UNREAD_RECEIPT_GRACE_MS);
    const candidates = await this.persistence.listUnreadReceipts(uploadedBefore, CANDIDATES);
    const pending = candidates.filter((receiptId) => !options.skip?.(receiptId)).slice(0, BATCH);
    const recovered: string[] = [];
    const failed: { receiptId: string; reason: string }[] = [];
    for (const receiptId of pending) {
      try {
        await this.processReceipt.execute({ receiptId });
        recovered.push(receiptId);
      } catch (error) {
        failed.push({ receiptId, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { recovered, failed };
  }
}
