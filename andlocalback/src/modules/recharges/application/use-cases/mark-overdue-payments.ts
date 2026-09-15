import { PostpaidTransactionPersistencePort } from "../ports/postpaid-transaction.ports";

export type MarkOverduePaymentsResult = Readonly<{
  markedCount: number;
  processedAt: string;
}>;

export class MarkOverduePayments {
  constructor(
    private readonly persistence: PostpaidTransactionPersistencePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(asOf = this.clock()): Promise<MarkOverduePaymentsResult> {
    const markedCount = await this.persistence.markOverduePayments(asOf);
    return { markedCount, processedAt: asOf.toISOString() };
  }
}
