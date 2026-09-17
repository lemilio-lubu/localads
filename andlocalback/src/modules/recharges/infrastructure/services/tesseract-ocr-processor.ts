import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createWorker, OEM, Worker } from "tesseract.js";
import { OcrProcessor } from "../../application/ports/recharge.ports";
import { ReceiptUpload } from "../../domain/recharge.types";
import { ReceiptTextInterpreter } from "../../domain/ocr/receipt-text-interpreter";

/** Un comprobante ilegible no puede retener el worker indefinidamente. */
const OCR_TIMEOUT_MS = 30_000;

@Injectable()
export class TesseractOcrProcessor implements OcrProcessor, OnModuleDestroy {
  private readonly logger = new Logger(TesseractOcrProcessor.name);
  private workerPromise: Promise<Worker> | null = null;
  private readonly interpreter = new ReceiptTextInterpreter();

  async process(upload: ReceiptUpload) {
    if (upload.mimeType === "application/pdf") {
      throw new Error("Tesseract.js no procesa PDF directamente; el comprobante queda disponible para revisión manual");
    }

    let data;
    try {
      const worker = await this.getWorker();
      ({ data } = await this.withTimeout(worker.recognize(upload.buffer)));
    } catch (error: unknown) {
      // Una imagen corrupta deja al worker en un estado del que no se recupera,
      // asi que se descarta para que el siguiente comprobante arranque limpio.
      await this.disposeWorker();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`El comprobante no pudo leerse automaticamente: ${detail}`);
    }

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
    await this.disposeWorker();
  }

  private getWorker() {
    // Sin errorHandler, tesseract.js relanza el fallo del worker fuera de toda
    // promesa y tumba el proceso. Con el, el rechazo llega a este await.
    this.workerPromise ??= createWorker("spa", OEM.LSTM_ONLY, {
      errorHandler: (reason: unknown) => {
        this.logger.error(`Fallo del worker OCR: ${reason instanceof Error ? reason.message : String(reason)}`);
      },
    });
    return this.workerPromise;
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("tiempo de proceso agotado")), OCR_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async disposeWorker() {
    const pending = this.workerPromise;
    this.workerPromise = null;
    if (!pending) return;
    try {
      await (await pending).terminate();
    } catch {
      // Un worker ya caido no necesita terminarse.
    }
  }
}
