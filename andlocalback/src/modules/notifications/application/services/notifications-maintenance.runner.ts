import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DeliverEmailNotifications } from "../use-cases/deliver-email-notifications";
import { PurgeOldNotifications } from "../use-cases/purge-old-notifications";

const DEFAULT_INTERVAL_MS = 60_000;
const MINIMUM_INTERVAL_MS = 1_000;
/* La limpieza no tiene prisa: basta unas pocas veces al día. */
const PURGE_EVERY_MS = 6 * 60 * 60_000;

/**
 * Mantenimiento de los avisos, en proceso como el despachador: reintenta los
 * correos que fallaron y, cada pocas horas, borra lo que pasó su retención.
 * Ambos son seguros con varias instancias (reserva con SKIP LOCKED y borrado
 * idempotente).
 */
@Injectable()
export class NotificationsMaintenanceRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsMaintenanceRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPurgeAt = 0;

  constructor(private readonly email: DeliverEmailNotifications, private readonly purge: PurgeOldNotifications) {}

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
      const retried = await this.email.retryPending();
      if (retried.sent > 0) this.logger.log(`${retried.sent} correo(s) reintentado(s) con éxito`);
      if (retried.failed > 0) this.logger.warn(`${retried.failed} correo(s) volvieron a fallar; se reintentarán más tarde`);
    } catch (error) {
      this.logger.error(`No se pudieron reintentar los correos: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Date.now() - this.lastPurgeAt >= PURGE_EVERY_MS) {
      try {
        const deleted = await this.purge.execute();
        this.lastPurgeAt = Date.now();
        if (deleted > 0) this.logger.log(`${deleted} aviso(s) viejo(s) borrado(s) de la bandeja`);
      } catch (error) {
        this.logger.error(`No se pudieron borrar los avisos viejos: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.running = false;
  }

  private resolveInterval(): number {
    const configured = Number(process.env.NOTIFICATIONS_MAINTENANCE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= MINIMUM_INTERVAL_MS ? configured : DEFAULT_INTERVAL_MS;
  }
}
