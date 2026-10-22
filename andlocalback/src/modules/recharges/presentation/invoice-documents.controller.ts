import { Controller, Get, Param, Res, UseFilters } from "@nestjs/common";
import { Response } from "express";
import { GetInvoiceDocument } from "../application/use-cases/get-invoice-document";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { ApplicationErrorFilter } from "./application-error.filter";

/* El PDF de la factura se sirve como los comprobantes: por ID, autenticado,
   sin caché y con la pertenencia comprobada en el caso de uso. */
@Controller("files/invoices")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN", "GESTOR", "CLIENT")
export class InvoiceDocumentsController {
  constructor(private readonly getInvoiceDocument: GetInvoiceDocument) {}

  @Get(":invoiceId/content")
  async content(@Param("invoiceId") invoiceId: string, @CurrentUser() user: AuthPrincipal, @Res() response: Response) {
    const document = await this.getInvoiceDocument.execute({
      invoiceId,
      viewer: { userId: user.userId, role: user.role as "ADMIN" | "GESTOR" | "CLIENT", clientId: user.clientId },
    });
    response.type(document.mimeType);
    response.set({
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store, max-age=0",
    });
    return response.send(Buffer.from(document.content));
  }
}
