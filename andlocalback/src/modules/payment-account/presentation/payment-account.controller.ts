import { Body, Controller, Get, Put, Query, UseFilters } from "@nestjs/common";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationErrorFilter } from "../../recharges/presentation/application-error.filter";
import { GetPaymentAccount } from "../application/use-cases/get-payment-account";
import { ListPaymentAccountHistory } from "../application/use-cases/list-payment-account-history";
import { UpdatePaymentAccount } from "../application/use-cases/update-payment-account";
import { UpdatePaymentAccountDto } from "./dto/payment-account.dto";

@Controller()
@UseFilters(ApplicationErrorFilter)
export class PaymentAccountController {
  constructor(
    private readonly getAccount: GetPaymentAccount,
    private readonly updateAccount: UpdatePaymentAccount,
    private readonly listHistory: ListPaymentAccountHistory,
  ) {}

  /* Cliente, gestor y admin: el cliente la necesita para pagar y el equipo para
     orientarlo. La referencia solo se resuelve para el cliente del token. */
  @Get("payment-account")
  @Roles("CLIENT", "GESTOR", "ADMIN")
  get(@CurrentUser() user: AuthPrincipal) {
    return this.getAccount.execute({ clientId: user.role === "CLIENT" ? user.clientId : null });
  }

  @Put("admin/payment-account")
  @Roles("ADMIN")
  update(@Body() body: UpdatePaymentAccountDto, @CurrentUser() user: AuthPrincipal) {
    return this.updateAccount.execute({ administratorId: user.userId, account: body });
  }

  @Get("admin/payment-account/history")
  @Roles("ADMIN")
  history(@Query("limit") limit?: string) {
    return this.listHistory.execute(limit ? Number(limit) : undefined);
  }
}
