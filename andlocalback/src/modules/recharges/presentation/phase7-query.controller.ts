import { Controller, ForbiddenException, Get, Param, Query, UseFilters } from "@nestjs/common";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationError } from "../../../common/errors/application.error";
import { GetAdminTransactionDetail } from "../application/use-cases/get-admin-transaction-detail";
import { GetMyPautas } from "../application/use-cases/get-my-pautas";
import { GetRechargeContext } from "../application/use-cases/get-recharge-context";
import { GetMyTransactionDetail } from "../application/use-cases/get-my-transaction-detail";
import { GetMyTransactions } from "../application/use-cases/get-my-transactions";
import { GetWalletOverview } from "../application/use-cases/get-wallet-overview";
import { ListAdminTransactions } from "../application/use-cases/list-admin-transactions";
import { ListVerifications } from "../application/use-cases/list-verifications";
import { ApplicationErrorFilter } from "./application-error.filter";
import { requireClientId } from "./client-identity";
import {
  AdminTransactionsQueryDto,
  AdminVerificationsQueryDto,
  PaginationQueryDto,
} from "./dto/phase7-query.dto";

@Controller("me")
@UseFilters(ApplicationErrorFilter)
@Roles("CLIENT")
export class MyRechargeQueriesController {
  constructor(
    private readonly getPautas: GetMyPautas,
    private readonly getContext: GetRechargeContext,
    private readonly getWallet: GetWalletOverview,
    private readonly getTransactions: GetMyTransactions,
    private readonly getTransactionDetail: GetMyTransactionDetail,
  ) {}

  @Get("recharge-context")
  rechargeContext(@CurrentUser() user: AuthPrincipal | string | undefined) {
    return this.getContext.execute({ clientId: requireAuthenticatedClient(user) });
  }

  @Get("pautas")
  pautas(@CurrentUser() user: AuthPrincipal | string | undefined) {
    return this.getPautas.execute({ clientId: requireAuthenticatedClient(user) });
  }

  @Get("wallet")
  wallet(@CurrentUser() user: AuthPrincipal | string | undefined) {
    return this.getWallet.execute({ clientId: requireAuthenticatedClient(user) });
  }

  @Get("transactions")
  transactions(
    @CurrentUser() user: AuthPrincipal | string | undefined,
    @Query() query: PaginationQueryDto,
  ) {
    return this.getTransactions.execute({
      clientId: requireAuthenticatedClient(user),
      page: query.page,
      pageSize: query.limit,
    });
  }

  @Get("transactions/:transactionId")
  transactionDetail(
    @CurrentUser() user: AuthPrincipal | string | undefined,
    @Param("transactionId") transactionId: string,
  ) {
    return this.getTransactionDetail.execute({
      clientId: requireAuthenticatedClient(user),
      transactionId: requirePathId(transactionId, "TRANSACTION_ID_REQUIRED"),
    });
  }
}

@Controller("admin")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN")
export class AdminRechargeQueriesController {
  constructor(
    private readonly listTransactions: ListAdminTransactions,
    private readonly getTransactionDetail: GetAdminTransactionDetail,
    private readonly listVerifications: ListVerifications,
  ) {}

  @Get("transactions")
  transactions(@Query() query: AdminTransactionsQueryDto) {
    return this.listTransactions.execute({
      page: query.page,
      pageSize: query.limit,
      clientId: query.clientId,
      accountType: query.accountType,
      rechargeStatus: query.rechargeStatus,
      paymentStatus: query.paymentStatus,
      dateFrom: toDate(query.from),
      dateTo: toDate(query.to),
    });
  }

  @Get("transactions/:transactionId")
  transactionDetail(@Param("transactionId") transactionId: string) {
    return this.getTransactionDetail.execute({
      transactionId: requirePathId(transactionId, "TRANSACTION_ID_REQUIRED"),
    });
  }

  @Get("verifications")
  verifications(@Query() query: AdminVerificationsQueryDto) {
    return this.listVerifications.execute({
      page: query.page,
      pageSize: query.limit,
      scope: query.scope,
      status: query.status,
      search: query.search,
      clientId: query.clientId,
      bank: query.bank,
      dateFrom: toDate(query.from),
      dateTo: toDate(query.to),
    });
  }
}

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

function requirePathId(value: string | undefined, code: string): string {
  const id = value?.trim();
  if (!id) throw new ApplicationError(code, "El identificador es obligatorio");
  return id;
}

function requireAuthenticatedClient(user: AuthPrincipal | string | undefined): string {
  if (typeof user === "string" || user === undefined) return requireClientId(user);
  if (!user.clientId) throw new ForbiddenException("El usuario no está vinculado a un cliente");
  return user.clientId;
}
