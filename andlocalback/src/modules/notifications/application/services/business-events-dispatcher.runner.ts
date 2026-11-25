import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DispatchBusinessEvents } from "../use-cases/dispatch-business-events";

const DEFAULT_INTERVAL_MS = 3_000;
const MINIMUM_INTERVAL_MS = 1_000;

/**
 * Temporizador en proceso, como los de facturas y vencidos. La reserva con
 * SKIP LOCKED hace seguro tener varias instancias; pg-boss podrá sustituirlo
 * sin tocar el caso de uso (ver plan-colas).
 */
@Injectable()
export class BusinessEventsDispatcherRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusinessEventsDispatcherRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly dispatch: DispatchBusinessEvents) {}

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
      const result = await this.dispatch.execute();
      if (result.failed > 0) this.logger.warn(`${result.failed} hecho(s) sin procesar; se reintentarán`);
      if (result.deliveryFailed > 0) this.logger.warn(`${result.deliveryFailed} envío(s) por push o correo fallidos; los avisos siguen en la bandeja`);
    } catch (error) {
      this.logger.error(`No se pudieron despachar los avisos: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private resolveInterval(): number {
    const configured = Number(process.env.NOTIFICATIONS_DISPATCH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= MINIMUM_INTERVAL_MS ? configured : DEFAULT_INTERVAL_MS;
  }
}
