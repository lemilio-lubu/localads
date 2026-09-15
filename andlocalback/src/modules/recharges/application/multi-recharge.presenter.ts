import { MonetaryAmount } from "../domain/value-objects/monetary-amount";
import { PrepaidTransactionRecord, PrepaidTransactionView } from "./ports/multi-recharge.ports";
import { PostpaidTransactionRecord, PostpaidTransactionView } from "./ports/postpaid-transaction.ports";

/** Pure serializer shared by persistence adapters and test doubles. */
export function presentPrepaidTransaction(record: PrepaidTransactionRecord): PrepaidTransactionView {
  const { receipt } = record;
  return {
    ...presentPostpaidTransaction(record),
    receipt: {
      id: receipt.id,
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      size: receipt.size,
      url: receipt.url,
      checksum: receipt.checksum,
      createdAt: receipt.createdAt ?? null,
    },
  };
}

/** Pure serializer for a postpaid aggregate, which has no initial receipt. */
export function presentPostpaidTransaction(record: PostpaidTransactionRecord): PostpaidTransactionView {
  const { transaction, payment } = record;
  const money = (value: MonetaryAmount) => value.toSafeNumber();
  return {
    id: transaction.id,
    code: transaction.code,
    idempotencyKey: transaction.idempotencyKey,
    clientId: transaction.clientId,
    accountId: transaction.accountId,
    accountTypeSnapshot: transaction.accountTypeSnapshot,
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
    totals: {
      pautaAmount: money(transaction.totals.pautaAmount),
      isdAmount: money(transaction.totals.isdAmount),
      agencyCommissionAmount: money(transaction.totals.agencyCommissionAmount),
      vatBaseAmount: money(transaction.totals.vatBaseAmount),
      vatAmount: money(transaction.totals.vatAmount),
      totalAmount: money(transaction.totals.totalAmount),
    },
    details: transaction.details.map((detail) => ({
      id: detail.id,
      pautaId: detail.pautaSnapshot.pautaId,
      platform: detail.pautaSnapshot.platform,
      externalAccountId: detail.pautaSnapshot.externalAccountId,
      requestedAmount: money(detail.pricing.pautaAmount),
      isdAmount: money(detail.pricing.isdAmount),
      agencyCommissionAmount: money(detail.pricing.agencyCommissionAmount),
      vatBaseAmount: money(detail.pricing.vatBaseAmount),
      vatAmount: money(detail.pricing.vatAmount),
      totalAmount: money(detail.pricing.totalAmount),
      status: detail.status,
      createdAt: detail.createdAt.toISOString(),
    })),
    payment: {
      id: payment.id,
      transactionId: payment.transactionId,
      accountTypeSnapshot: payment.accountTypeSnapshot,
      status: payment.status,
      expectedAmount: money(payment.expectedAmount),
      confirmedAmount: payment.confirmedAmount ? money(payment.confirmedAmount) : null,
      dueDate: payment.dueDate?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    },
  };
}
