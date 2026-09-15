import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { MarkOverduePayments } from "../use-cases/mark-overdue-payments";

const DEFAULT_INTERVAL_MS = 60_000;
const MINIMUM_INTERVAL_MS = 1_000;

/**
 * Lightweight in-process runner for phase 4. The use case and persistence layer
 * remain idempotent, so another scheduler can replace this adapter later.
 */
@Injectable()
export class OverduePaymentsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverduePaymentsRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly markOverduePayments: MarkOverduePayments) {}

  onModuleInit(): void {
    void this.runOnce();
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
      const result = await this.markOverduePayments.execute();
      if (result.markedCount > 0) {
        this.logger.log(`${result.markedCount} pago(s) postpago marcado(s) como vencido(s)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudieron marcar los pagos vencidos: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private resolveInterval(): number {
    const configured = Number(process.env.OVERDUE_PAYMENTS_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= MINIMUM_INTERVAL_MS
      ? configured
      : DEFAULT_INTERVAL_MS;
  }
}
