import { PostpaidTransactionPersistencePort } from "../ports/postpaid-transaction.ports";
import { PlatformRealtimePublisher, silentPlatformRealtime } from "../ports/platform-realtime.ports";

export type MarkOverduePaymentsResult = Readonly<{
  markedCount: number;
  processedAt: string;
}>;

export class MarkOverduePayments {
  constructor(
    private readonly persistence: PostpaidTransactionPersistencePort,
    private readonly clock: () => Date = () => new Date(),
    private readonly realtime: PlatformRealtimePublisher = silentPlatformRealtime,
  ) {}

  async execute(asOf = this.clock()): Promise<MarkOverduePaymentsResult> {
    const marked = await this.persistence.markOverduePayments(asOf);
    /* Un aviso por cliente, aunque tenga varios pagos vencidos a la vez. */
    for (const clientId of new Set(marked.clientIds)) this.realtime.publishPlatforms(clientId);
    return { markedCount: marked.count, processedAt: asOf.toISOString() };
  }
}
