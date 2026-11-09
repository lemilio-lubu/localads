import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RecoverUnreadReceipts } from "../use-cases/recover-unread-receipts";
import { TransactionReceiptOcrDispatcher } from "./transaction-receipt-ocr-dispatcher";

const DEFAULT_INTERVAL_MS = 120_000;
const MINIMUM_INTERVAL_MS = 5_000;
const FIRST_RETRY_MS = 2 * 60_000;
const MAX_RETRY_MS = 60 * 60_000;

/**
 * Cada 2 minutos lee los comprobantes que se quedaron sin leer (ver
 * `RecoverUnreadReceipts`). Como los runners de facturas y vencimientos, es un
 * temporizador en proceso: con varias instancias del backend, la reserva por
 * versión del comprobante impide guardar dos lecturas.
 *
 * Un comprobante que falla otra vez espera cada vez más (2, 4, 8… hasta 60
 * minutos) para no ocupar la CPU ni tapar a los demás. Esa espera vive en
 * memoria: tras un reinicio se intenta de nuevo, que es lo que se busca.
 */
@Injectable()
export class ReceiptOcrRecoveryRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptOcrRecoveryRunner.name);
  private readonly retries = new Map<string, Readonly<{ attempts: number; retryAt: number }>>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly recoverUnreadReceipts: RecoverUnreadReceipts,
    private readonly dispatcher: TransactionReceiptOcrDispatcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), this.resolveInterval());
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      const result = await this.recoverUnreadReceipts.execute({
        skip: (receiptId) => this.dispatcher.isInFlight(receiptId) || (this.retries.get(receiptId)?.retryAt ?? 0) > now,
      });
      for (const receiptId of result.recovered) this.retries.delete(receiptId);
      if (result.recovered.length > 0) this.logger.log(`${result.recovered.length} comprobante(s) sin leer recuperado(s)`);
      for (const { receiptId, reason } of result.failed) {
        const attempts = (this.retries.get(receiptId)?.attempts ?? 0) + 1;
        const wait = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
        this.retries.set(receiptId, { attempts, retryAt: now + wait });
        this.logger.warn(`Comprobante ${receiptId} sin leer (intento ${attempts}): ${reason}`);
      }
    } catch (error) {
      this.logger.error(`No se pudieron recuperar los comprobantes sin leer: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private resolveInterval(): number {
    const configured = Number(process.env.OCR_RECOVERY_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= MINIMUM_INTERVAL_MS ? configured : DEFAULT_INTERVAL_MS;
  }
}
