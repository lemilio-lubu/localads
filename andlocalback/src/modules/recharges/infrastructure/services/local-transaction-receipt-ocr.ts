import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TransactionReceiptOcrPort, TransactionReceiptSnapshot } from "../../application/ports/transaction-verification.ports";
import { OcrProcessor } from "../../application/ports/recharge.ports";
import { ReceiptTextInterpreter } from "../../domain/ocr/receipt-text-interpreter";

export class LocalTransactionReceiptOcr implements TransactionReceiptOcrPort {
  private readonly interpreter = new ReceiptTextInterpreter();

  constructor(private readonly legacyOcr: OcrProcessor) {}

  async process(receipt: TransactionReceiptSnapshot) {
    const receiptsDirectory = resolve(process.cwd(), "uploads", "receipts");
    const receiptPath = resolve(process.cwd(), receipt.url.replace(/^[/\\]+/, ""));
    const pathFromReceipts = relative(receiptsDirectory, receiptPath);
    if (!pathFromReceipts || pathFromReceipts.startsWith("..") || isAbsolute(pathFromReceipts)) {
      throw new Error("La ruta del comprobante no es valida");
    }

    const buffer = await readFile(receiptPath);
    const legacyResult = await this.legacyOcr.process({
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      size: buffer.length,
      buffer,
    });
    return this.interpreter.interpret(legacyResult.text, legacyResult.confidence);
  }
}
