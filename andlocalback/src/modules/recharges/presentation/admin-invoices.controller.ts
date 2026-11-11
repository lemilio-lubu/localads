import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseFilters } from "@nestjs/common";
import { ListUnauthorizedInvoices } from "../application/use-cases/list-unauthorized-invoices";
import { RetryInvoiceAuthorization } from "../application/use-cases/retry-invoice-authorization";
import { Roles } from "../../auth/auth.decorators";
import { ApplicationErrorFilter } from "./application-error.filter";

/* Facturas que no logran autorizarse: por qué, cuántos intentos llevan y un
   reintento inmediato. Solo el admin: es operación del sistema, no cartera. */
@Controller("admin/invoices")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN")
export class AdminInvoicesController {
  constructor(
    private readonly listUnauthorized: ListUnauthorizedInvoices,
    private readonly retryAuthorization: RetryInvoiceAuthorization,
  ) {}

  @Get("unauthorized")
  unauthorized() {
    return this.listUnauthorized.execute();
  }

  @Post(":invoiceId/retry")
  @HttpCode(HttpStatus.OK)
  retry(@Param("invoiceId") invoiceId: string) {
    return this.retryAuthorization.execute({ invoiceId });
  }
}
