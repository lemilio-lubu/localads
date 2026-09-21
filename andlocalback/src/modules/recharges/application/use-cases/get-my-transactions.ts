import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { PageResult, Phase7QueryPort, TransactionListItemView } from "../ports/phase7-query.ports";
import { assertDateRange, optionalDate, optionalText, pagination, requiredQueryId } from "./phase7-query.validation";

export type GetMyTransactionsQuery = Readonly<{
  clientId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  rechargeStatus?: TransactionRechargeStatus;
  paymentStatus?: TransactionPaymentStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}>;

export class GetMyTransactions {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(input: GetMyTransactionsQuery): Promise<PageResult<TransactionListItemView>> {
    const clientId = requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio");
    const dateFrom = optionalDate(input.dateFrom, "dateFrom");
    const dateTo = optionalDate(input.dateTo, "dateTo");
    assertDateRange(dateFrom, dateTo);
    return this.queries.listTransactionsByClient({
      clientId,
      ...pagination(input.page, input.pageSize),
      search: optionalText(input.search),
      rechargeStatus: input.rechargeStatus,
      paymentStatus: input.paymentStatus,
      dateFrom,
      dateTo,
    });
  }
}
