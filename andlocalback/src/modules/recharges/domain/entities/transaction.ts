import { AccountType } from "../recharge.types";
import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../model/domain-status";
import { MonetaryAmount } from "../value-objects/monetary-amount";
import { CreateTransactionDetailProps, TransactionDetail } from "./transaction-detail";

export type TransactionTotals = Readonly<{
  pautaAmount: MonetaryAmount;
  isdAmount: MonetaryAmount;
  agencyCommissionAmount: MonetaryAmount;
  vatBaseAmount: MonetaryAmount;
  vatAmount: MonetaryAmount;
  totalAmount: MonetaryAmount;
}>;

export type CreateTransactionProps = Readonly<{
  id: string;
  code: string;
  idempotencyKey: string;
  clientId: string;
  accountId: string;
  accountTypeSnapshot: AccountType;
  details: readonly CreateTransactionDetailProps[];
  createdAt?: Date;
}>;

export class Transaction {
  public readonly id: string;
  public readonly code: string;
  public readonly idempotencyKey: string;
  public readonly clientId: string;
  public readonly accountId: string;
  public readonly accountTypeSnapshot: AccountType;
  public readonly details: readonly TransactionDetail[];
  public readonly totals: TransactionTotals;
  public readonly createdAt: Date;
  private statusValue = TransactionRechargeStatus.REQUESTED;
  private completedAtValue: Date | null = null;

  private constructor(props: CreateTransactionProps) {
    assertNonEmpty(props.id, "transaccionId");
    assertNonEmpty(props.code, "codigoTransaccion");
    assertNonEmpty(props.idempotencyKey, "idempotencyKey");
    assertNonEmpty(props.clientId, "clientId");
    assertNonEmpty(props.accountId, "accountId");
    if (!Object.values(AccountType).includes(props.accountTypeSnapshot)) {
      throw new DomainError("INVALID_ACCOUNT_TYPE_SNAPSHOT", "El tipo de cuenta historico no es valido");
    }
    if (props.details.length === 0) {
      throw new DomainError("TRANSACTION_DETAILS_REQUIRED", "La transaccion requiere al menos un detalle");
    }

    const pautaIds = props.details.map((detail) => detail.pauta.pautaId);
    if (new Set(pautaIds).size !== pautaIds.length) {
      throw new DomainError("DUPLICATE_PAUTA", "Una pauta no puede repetirse en la misma transaccion");
    }

    this.id = props.id;
    this.code = props.code;
    this.idempotencyKey = props.idempotencyKey;
    this.clientId = props.clientId;
    this.accountId = props.accountId;
    this.accountTypeSnapshot = props.accountTypeSnapshot;
    this.details = Object.freeze(props.details.map((detail) => TransactionDetail.create(detail)));
    this.totals = Transaction.sumTotals(this.details);
    this.createdAt = cloneDate(props.createdAt ?? new Date());
  }

  static create(props: CreateTransactionProps): Transaction {
    return new Transaction(props);
  }

  get status(): TransactionRechargeStatus { return this.statusValue; }
  get completedAt(): Date | null { return this.completedAtValue ? cloneDate(this.completedAtValue) : null; }

  markUnderReview(): void {
    this.assertStatus(TransactionRechargeStatus.REQUESTED);
    this.statusValue = TransactionRechargeStatus.UNDER_REVIEW;
  }

  authorize(): void {
    if (this.statusValue !== TransactionRechargeStatus.REQUESTED && this.statusValue !== TransactionRechargeStatus.UNDER_REVIEW) {
      throw new DomainError("INVALID_TRANSACTION_TRANSITION", "La recarga no puede autorizarse desde su estado actual");
    }
    for (const detail of this.details) detail.approve();
    this.statusValue = TransactionRechargeStatus.APPROVED;
  }

  startProcessing(): void {
    this.assertStatus(TransactionRechargeStatus.APPROVED);
    for (const detail of this.details) detail.startProcessing();
    this.statusValue = TransactionRechargeStatus.PROCESSING;
  }

  completeDetail(detailId: string, effectiveAmount: MonetaryAmount, at = new Date()): void {
    this.assertStatus(TransactionRechargeStatus.PROCESSING);
    const detail = this.details.find((candidate) => candidate.id === detailId);
    if (!detail) throw new DomainError("TRANSACTION_DETAIL_NOT_FOUND", "El detalle no pertenece a la transaccion");
    detail.complete(effectiveAmount, at);
  }

  complete(at = new Date()): void {
    if (this.statusValue === TransactionRechargeStatus.COMPLETED) return;
    this.assertStatus(TransactionRechargeStatus.PROCESSING);
    if (this.details.some((detail) => detail.status !== TransactionDetailStatus.COMPLETED)) {
      throw new DomainError("INCOMPLETE_TRANSACTION_DETAILS", "Todos los detalles deben estar completados");
    }
    this.completedAtValue = cloneDate(at);
    this.statusValue = TransactionRechargeStatus.COMPLETED;
  }

  private assertStatus(expected: TransactionRechargeStatus): void {
    if (this.statusValue !== expected) {
      throw new DomainError("INVALID_TRANSACTION_TRANSITION", `La transaccion debe estar ${expected}`);
    }
  }

  private static sumTotals(details: readonly TransactionDetail[]): TransactionTotals {
    return Object.freeze(details.reduce<TransactionTotals>((totals, detail) => ({
      pautaAmount: totals.pautaAmount.add(detail.pricing.pautaAmount),
      isdAmount: totals.isdAmount.add(detail.pricing.isdAmount),
      agencyCommissionAmount: totals.agencyCommissionAmount.add(detail.pricing.agencyCommissionAmount),
      vatBaseAmount: totals.vatBaseAmount.add(detail.pricing.vatBaseAmount),
      vatAmount: totals.vatAmount.add(detail.pricing.vatAmount),
      totalAmount: totals.totalAmount.add(detail.pricing.totalAmount),
    }), {
      pautaAmount: MonetaryAmount.zero(),
      isdAmount: MonetaryAmount.zero(),
      agencyCommissionAmount: MonetaryAmount.zero(),
      vatBaseAmount: MonetaryAmount.zero(),
      vatAmount: MonetaryAmount.zero(),
      totalAmount: MonetaryAmount.zero(),
    }));
  }
}
