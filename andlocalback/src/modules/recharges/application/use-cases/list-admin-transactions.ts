import { AccountType } from "../../domain/recharge.types";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { AdminTransactionPage, Phase7QueryPort } from "../ports/phase7-query.ports";
import { assertDateRange, optionalDate, optionalText, pagination } from "./phase7-query.validation";

export type ListAdminTransactionsQuery = Readonly<{
  /* Sale del token, no de la query: un gestor no puede ampliar su alcance
     escribiendo otro id, porque nunca se lee del request. */
  managerId?: string;
  /* Filtro del admin: registros de clientes sin gestor. */
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
  search?: string;
  clientId?: string;
  accountType?: AccountType;
  rechargeStatus?: TransactionRechargeStatus;
  paymentStatus?: TransactionPaymentStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}>;

export class ListAdminTransactions {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(query: ListAdminTransactionsQuery): Promise<AdminTransactionPage> {
    const dateFrom = optionalDate(query.dateFrom, "dateFrom");
    const dateTo = optionalDate(query.dateTo, "dateTo");
    assertDateRange(dateFrom, dateTo);
    return this.queries.listTransactions({
      ...pagination(query.page, query.pageSize),
      managerId: optionalText(query.managerId),
      unassigned: query.unassigned,
      search: optionalText(query.search),
      clientId: optionalText(query.clientId),
      accountType: query.accountType,
      rechargeStatus: query.rechargeStatus,
      paymentStatus: query.paymentStatus,
      dateFrom,
      dateTo,
    });
  }
}
