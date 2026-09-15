import { AccountType } from "../../domain/recharge.types";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { PageResult, Phase7QueryPort, TransactionListItemView } from "../ports/phase7-query.ports";
import { assertDateRange, optionalDate, optionalText, pagination } from "./phase7-query.validation";

export type ListAdminTransactionsQuery = Readonly<{
  page?: number;
  pageSize?: number;
  clientId?: string;
  accountType?: AccountType;
  rechargeStatus?: TransactionRechargeStatus;
  paymentStatus?: TransactionPaymentStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}>;

export class ListAdminTransactions {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(query: ListAdminTransactionsQuery): Promise<PageResult<TransactionListItemView>> {
    const dateFrom = optionalDate(query.dateFrom, "dateFrom");
    const dateTo = optionalDate(query.dateTo, "dateTo");
    assertDateRange(dateFrom, dateTo);
    return this.queries.listTransactions({
      ...pagination(query.page, query.pageSize),
      clientId: optionalText(query.clientId),
      accountType: query.accountType,
      rechargeStatus: query.rechargeStatus,
      paymentStatus: query.paymentStatus,
      dateFrom,
      dateTo,
    });
  }
}
