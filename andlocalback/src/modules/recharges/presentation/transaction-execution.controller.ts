import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post, UseFilters } from "@nestjs/common";
import { CompleteTransaction } from "../application/use-cases/complete-transaction";
import { CompleteTransactionDetail } from "../application/use-cases/complete-transaction-detail";
import { StartTransactionRecharge } from "../application/use-cases/start-transaction-recharge";
import { ApplicationErrorFilter } from "./application-error.filter";
import { scopeFor } from "../../../common/access/manager-scope";
import { AssertManagerScope } from "../application/ports/manager-scope.ports";
import { CompleteTransactionDetailDto } from "./dto/complete-transaction-detail.dto";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { PrismaTransactionExecutionRepository } from "../infrastructure/persistence/prisma-transaction-execution.repository";
import { TransactionsGateway } from "./transactions.gateway";
import { ResumeTransactionDetailDto } from "./dto/resume-transaction-detail.dto";

/* Ejecutar una recarga es una decision administrativa mas: el gestor la toma
   sobre las transacciones de su cartera, comprobada en cada metodo. */
@Controller("transactions")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN", "GESTOR")
export class TransactionExecutionController {
  constructor(
    private readonly startTransactionRecharge: StartTransactionRecharge,
    private readonly completeTransactionDetail: CompleteTransactionDetail,
    private readonly completeTransaction: CompleteTransaction,
    private readonly execution: PrismaTransactionExecutionRepository,
    private readonly realtime: TransactionsGateway,
    private readonly scope: AssertManagerScope,
  ) {}

  @Patch(":transactionId/details/:detailId/resume")
  @HttpCode(HttpStatus.OK)
  async resume(@Param("transactionId") transactionId: string, @Param("detailId") detailId: string, @CurrentUser() user: AuthPrincipal, @Body() body: ResumeTransactionDetailDto) {
    await this.scope.transaction(transactionId, scopeFor(user));
    const result = await this.execution.resumeDetail(transactionId, detailId, user.userId, body.expectedVersion);
    this.realtime.publishPlatforms(result.clientId);
    return result;
  }

  @Post(":transactionId/start")
  @HttpCode(HttpStatus.OK)
  async start(@Param("transactionId") transactionId: string, @CurrentUser() user: AuthPrincipal) {
    await this.scope.transaction(transactionId, scopeFor(user));
    return this.startTransactionRecharge.execute({ transactionId });
  }

  @Patch(":transactionId/details/:detailId/complete")
  @HttpCode(HttpStatus.OK)
  async completeDetail(
    @Param("transactionId") transactionId: string,
    @Param("detailId") detailId: string,
    @Body() body: CompleteTransactionDetailDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.scope.transaction(transactionId, scopeFor(user));
    return this.completeTransactionDetail.execute({
      transactionId,
      detailId,
      effectiveAmount: Number(body.effectiveAmount),
      effectiveRechargeDate: body.effectiveRechargeDate
        ? new Date(body.effectiveRechargeDate)
        : new Date(),
    });
  }

  @Post(":transactionId/complete")
  @HttpCode(HttpStatus.OK)
  async complete(@Param("transactionId") transactionId: string, @CurrentUser() user: AuthPrincipal) {
    await this.scope.transaction(transactionId, scopeFor(user));
    return this.completeTransaction.execute({ transactionId });
  }
}
