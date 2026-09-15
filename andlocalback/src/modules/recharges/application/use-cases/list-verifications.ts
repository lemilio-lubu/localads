import { VerificationStatus } from "../../domain/recharge.types";
import { PageResult, Phase7QueryPort, VerificationListItemView, VerificationScope } from "../ports/phase7-query.ports";
import { assertDateRange, optionalDate, optionalText, pagination } from "./phase7-query.validation";

export type ListVerificationsQuery = Readonly<{
  page?: number;
  pageSize?: number;
  scope?: VerificationScope;
  status?: VerificationStatus;
  search?: string;
  clientId?: string;
  bank?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}>;

export class ListVerifications {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(query: ListVerificationsQuery): Promise<PageResult<VerificationListItemView>> {
    const dateFrom = optionalDate(query.dateFrom, "dateFrom");
    const dateTo = optionalDate(query.dateTo, "dateTo");
    assertDateRange(dateFrom, dateTo);
    return this.queries.listVerifications({
      ...pagination(query.page, query.pageSize),
      scope: query.scope ?? "REVIEW",
      status: query.status,
      search: optionalText(query.search),
      clientId: optionalText(query.clientId),
      bank: optionalText(query.bank),
      dateFrom,
      dateTo,
    });
  }
}
