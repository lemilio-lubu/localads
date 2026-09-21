import { Controller, ForbiddenException, Get, Param, Query, UseFilters } from "@nestjs/common";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationError } from "../../../common/errors/application.error";
import { scopeFor } from "../../../common/access/manager-scope";
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
  MyTransactionsQueryDto,
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
    @Query() query: MyTransactionsQueryDto,
  ) {
    return this.getTransactions.execute({
      clientId: requireAuthenticatedClient(user),
      page: query.page,
      pageSize: query.limit,
      search: query.search,
      rechargeStatus: query.rechargeStatus,
      paymentStatus: query.paymentStatus,
      dateFrom: toDate(query.from),
      dateTo: toDate(query.to),
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

/* Admin y gestor comparten estas tres pantallas; lo unico que cambia es el
   alcance, que sale del token en cada metodo. */
@Controller("admin")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN", "GESTOR")
export class AdminRechargeQueriesController {
  constructor(
    private readonly listTransactions: ListAdminTransactions,
    private readonly getTransactionDetail: GetAdminTransactionDetail,
    private readonly listVerifications: ListVerifications,
  ) {}

  @Get("transactions")
  transactions(@Query() query: AdminTransactionsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.listTransactions.execute({
      managerId: scopeFor(user).managerId,
      page: query.page,
      pageSize: query.limit,
      search: query.search,
      clientId: query.clientId,
      accountType: query.accountType,
      rechargeStatus: query.rechargeStatus,
      paymentStatus: query.paymentStatus,
      dateFrom: toDate(query.from),
      dateTo: toDate(query.to),
    });
  }

  @Get("transactions/:transactionId")
  transactionDetail(@Param("transactionId") transactionId: string, @CurrentUser() user: AuthPrincipal) {
    return this.getTransactionDetail.execute({
      transactionId: requirePathId(transactionId, "TRANSACTION_ID_REQUIRED"),
      managerId: scopeFor(user).managerId,
    });
  }

  @Get("verifications")
  verifications(@Query() query: AdminVerificationsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.listVerifications.execute({
      managerId: scopeFor(user).managerId,
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
