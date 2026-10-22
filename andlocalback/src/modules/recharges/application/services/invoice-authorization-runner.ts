import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuthorizeInvoice } from "../use-cases/authorize-invoice";
import { AuthorizePendingInvoices } from "../use-cases/authorize-pending-invoices";

const DEFAULT_INTERVAL_MS = 60_000;
const MINIMUM_INTERVAL_MS = 5_000;

/**
 * Autoriza la factura justo al completar la recarga, fuera de la respuesta
 * HTTP (dispatch), y reintenta cada minuto las que quedaron pendientes. Como
 * el de vencimientos, es un temporizador en proceso: la reserva atómica hace
 * seguro tener varias instancias del backend.
 */
@Injectable()
export class InvoiceAuthorizationRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceAuthorizationRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly authorizeInvoice: AuthorizeInvoice,
    private readonly authorizePending: AuthorizePendingInvoices,
  ) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.resolveInterval());
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  dispatch(invoiceId: string): void {
    setImmediate(() => {
      void this.authorizeInvoice.execute({ invoiceId })
        .then((result) => { if (result.status === "FAILED") this.logger.warn(`Factura ${invoiceId} sin autorizar: ${result.reason}`); })
        .catch((error: unknown) => this.logger.error(`No fue posible autorizar la factura ${invoiceId}: ${error instanceof Error ? error.message : String(error)}`));
    });
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.authorizePending.execute();
      if (result.authorized > 0) this.logger.log(`${result.authorized} factura(s) autorizada(s)`);
      if (result.failed > 0) this.logger.warn(`${result.failed} factura(s) siguen pendientes de autorizar`);
    } catch (error) {
      this.logger.error(`No se pudieron autorizar las facturas pendientes: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private resolveInterval(): number {
    const configured = Number(process.env.INVOICE_AUTHORIZATION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= MINIMUM_INTERVAL_MS ? configured : DEFAULT_INTERVAL_MS;
  }
}
