import { PostpaidTransactionPersistencePort } from "../ports/postpaid-transaction.ports";
import { PlatformRealtimePublisher, silentPlatformRealtime } from "../ports/platform-realtime.ports";

export type MarkOverduePaymentsResult = Readonly<{
  markedCount: number;
  remindedCount: number;
  processedAt: string;
}>;

/**
 * Barrido de los pagos pospago en crédito: marca los vencidos y deja escritos
 * los recordatorios que tocan (unos días antes y el mismo día). Ambos son
 * idempotentes, así que repetirlo no duplica nada.
 */
export class MarkOverduePayments {
  constructor(
    private readonly persistence: PostpaidTransactionPersistencePort,
    private readonly clock: () => Date = () => new Date(),
    private readonly realtime: PlatformRealtimePublisher = silentPlatformRealtime,
  ) {}

  async execute(asOf = this.clock()): Promise<MarkOverduePaymentsResult> {
    /* Primero los vencidos: un pago que venció no recibe además un «vence hoy». */
    const marked = await this.persistence.markOverduePayments(asOf);
    /* Un aviso por cliente, aunque tenga varios pagos vencidos a la vez. */
    for (const clientId of new Set(marked.clientIds)) this.realtime.publishPlatforms(clientId);
    const remindedCount = await this.persistence.remindDuePayments(asOf);
    return { markedCount: marked.count, remindedCount, processedAt: asOf.toISOString() };
  }
}
