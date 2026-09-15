import { PageResult, Phase7QueryPort, TransactionListItemView } from "../ports/phase7-query.ports";
import { pagination, requiredQueryId } from "./phase7-query.validation";

export class GetMyTransactions {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(input: Readonly<{ clientId: string; page?: number; pageSize?: number }>): Promise<PageResult<TransactionListItemView>> {
    const clientId = requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio");
    return this.queries.listTransactionsByClient({ clientId, ...pagination(input.page, input.pageSize) });
  }
}
