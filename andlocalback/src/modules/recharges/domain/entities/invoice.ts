import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { InvoiceStatus, TransactionRechargeStatus } from "../model/domain-status";
import { MonetaryAmount } from "../value-objects/monetary-amount";
import { Transaction, TransactionTotals } from "./transaction";

export type InvoiceAmounts = TransactionTotals;
export type CompletedTransactionInvoiceSnapshot = Readonly<{
  id: string;
  status: TransactionRechargeStatus;
  totals: TransactionTotals;
}>;

export class Invoice {
  private constructor(
    public readonly id: string,
    public readonly number: string,
    public readonly transactionId: string,
    public readonly amounts: InvoiceAmounts,
    public readonly issuedAt: Date,
    public readonly status = InvoiceStatus.ISSUED,
  ) {}

  static issue(id: string, number: string, transaction: Transaction, at = new Date()): Invoice {
    return Invoice.issueFromSnapshot(id, number, transaction, at);
  }

  static issueFromSnapshot(
    id: string,
    number: string,
    transaction: CompletedTransactionInvoiceSnapshot,
    at = new Date(),
  ): Invoice {
    assertNonEmpty(id, "facturaId");
    assertNonEmpty(number, "numeroFactura");
    if (transaction.status !== TransactionRechargeStatus.COMPLETED) {
      throw new DomainError("TRANSACTION_NOT_COMPLETED", "La factura solo puede emitirse despues de completar la recarga");
    }
    return new Invoice(id, number, transaction.id, Invoice.copyAmounts(transaction.totals), cloneDate(at));
  }

  private static copyAmounts(amounts: TransactionTotals): InvoiceAmounts {
    const copy = (amount: MonetaryAmount) => MonetaryAmount.fromCents(amount.cents);
    return Object.freeze({
      pautaAmount: copy(amounts.pautaAmount),
      isdAmount: copy(amounts.isdAmount),
      agencyCommissionAmount: copy(amounts.agencyCommissionAmount),
      vatBaseAmount: copy(amounts.vatBaseAmount),
      vatAmount: copy(amounts.vatAmount),
      totalAmount: copy(amounts.totalAmount),
    });
  }
}
