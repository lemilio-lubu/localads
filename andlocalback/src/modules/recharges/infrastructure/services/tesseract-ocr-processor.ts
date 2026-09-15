import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createWorker, Worker } from "tesseract.js";
import { OcrProcessor } from "../../application/ports/recharge.ports";
import { ReceiptUpload } from "../../domain/recharge.types";
import { ReceiptTextInterpreter } from "../../domain/ocr/receipt-text-interpreter";

@Injectable()
export class TesseractOcrProcessor implements OcrProcessor, OnModuleDestroy {
  private workerPromise: Promise<Worker> | null = null;
  private readonly interpreter = new ReceiptTextInterpreter();

  async process(upload: ReceiptUpload) {
    if (upload.mimeType === "application/pdf") {
      throw new Error("Tesseract.js no procesa PDF directamente; el comprobante queda disponible para revisión manual");
    }
    const { data } = await (await this.getWorker()).recognize(upload.buffer);
    const analysis = this.interpreter.interpret(data.text, data.confidence);
    return {
      text: analysis.originalText,
      confidence: analysis.confidence,
      detectedAmounts: analysis.detectedAmounts.map((amount) => amount.toSafeNumber()),
      bank: analysis.bank,
      transactionDate: analysis.transactionDate?.toISOString() ?? null,
      bankReference: analysis.bankReference,
      orderingParty: analysis.orderingParty,
    };
  }

  async onModuleDestroy() {
    if (this.workerPromise) await (await this.workerPromise).terminate();
  }

  private getWorker() {
    this.workerPromise ??= createWorker("spa");
    return this.workerPromise;
  }
}
