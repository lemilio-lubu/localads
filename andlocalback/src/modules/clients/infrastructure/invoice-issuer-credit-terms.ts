import { Logger } from "@nestjs/common";
import { InvoiceIssuer } from "../../recharges/application/ports/invoice-issuer.ports";
import { CreditTermsCatalog } from "../application/ports/credit-terms.port";

/**
 * Los días de crédito que acepta el emisor de facturas. Si Migo no responde,
 * no bloquea el alta del cliente: la factura avisará luego qué plazo falta.
 */
export class InvoiceIssuerCreditTerms implements CreditTermsCatalog {
  private readonly logger = new Logger(InvoiceIssuerCreditTerms.name);

  constructor(private readonly issuer: InvoiceIssuer) {}

  async allowedDays(): Promise<readonly number[] | null> {
    if (!this.issuer.creditTermDays) return null;
    try {
      return await this.issuer.creditTermDays();
    } catch (error) {
      this.logger.warn(`No se pudieron leer los plazos de pago del emisor: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
