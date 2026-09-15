import { AccountType } from "../recharge.types";
import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { TransactionPaymentStatus } from "../model/domain-status";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type CreatePaymentProps = Readonly<{
  id: string;
  transactionId: string;
  accountTypeSnapshot: AccountType;
  expectedAmount: MonetaryAmount;
  createdAt?: Date;
  dueDate?: Date | null;
}>;

export class Payment {
  public readonly id: string;
  public readonly transactionId: string;
  public readonly accountTypeSnapshot: AccountType;
  public readonly expectedAmount: MonetaryAmount;
  public readonly createdAt: Date;
  public readonly dueDate: Date | null;
  private statusValue: TransactionPaymentStatus;
  private confirmedAmountValue: MonetaryAmount | null = null;
  private confirmedAtValue: Date | null = null;

  private constructor(props: CreatePaymentProps) {
    assertNonEmpty(props.id, "pagoId");
    assertNonEmpty(props.transactionId, "transaccionId");
    if (!Object.values(AccountType).includes(props.accountTypeSnapshot)) {
      throw new DomainError("INVALID_ACCOUNT_TYPE_SNAPSHOT", "El tipo de cuenta historico no es valido");
    }
    if (props.expectedAmount.isZero) throw new DomainError("INVALID_AMOUNT", "El pago debe ser mayor que cero");
    if (props.accountTypeSnapshot === AccountType.POSTPAID && !props.dueDate) {
      throw new DomainError("PAYMENT_DUE_DATE_REQUIRED", "El pago postpago requiere fecha de vencimiento");
    }
    if (props.accountTypeSnapshot === AccountType.PREPAID && props.dueDate) {
      throw new DomainError("UNEXPECTED_PAYMENT_DUE_DATE", "El pago prepago no utiliza fecha de vencimiento");
    }

    this.id = props.id;
    this.transactionId = props.transactionId;
    this.accountTypeSnapshot = props.accountTypeSnapshot;
    this.expectedAmount = props.expectedAmount;
    this.createdAt = cloneDate(props.createdAt ?? new Date());
    this.dueDate = props.dueDate ? cloneDate(props.dueDate) : null;
    this.statusValue = props.accountTypeSnapshot === AccountType.PREPAID
      ? TransactionPaymentStatus.PENDING
      : TransactionPaymentStatus.IN_CREDIT;
  }

  static create(props: CreatePaymentProps): Payment { return new Payment(props); }

  get status(): TransactionPaymentStatus { return this.statusValue; }
  get confirmedAmount(): MonetaryAmount | null { return this.confirmedAmountValue; }
  get confirmedAt(): Date | null { return this.confirmedAtValue ? cloneDate(this.confirmedAtValue) : null; }

  sendToReview(): void {
    if (this.statusValue === TransactionPaymentStatus.PAID) {
      throw new DomainError("PAYMENT_ALREADY_CONFIRMED", "El pago ya fue confirmado");
    }
    if (this.statusValue !== TransactionPaymentStatus.PENDING &&
        this.statusValue !== TransactionPaymentStatus.IN_CREDIT &&
        this.statusValue !== TransactionPaymentStatus.REJECTED &&
        this.statusValue !== TransactionPaymentStatus.OVERDUE) {
      throw new DomainError("PAYMENT_NOT_REVIEWABLE", "El pago no admite un comprobante en su estado actual");
    }
    this.statusValue = TransactionPaymentStatus.UNDER_REVIEW;
  }

  confirm(amount: MonetaryAmount, at = new Date()): void {
    if (this.statusValue === TransactionPaymentStatus.PAID) return;
    if (this.statusValue !== TransactionPaymentStatus.UNDER_REVIEW) {
      throw new DomainError("PAYMENT_NOT_UNDER_REVIEW", "El pago debe estar en revision");
    }
    if (!amount.equals(this.expectedAmount)) {
      throw new DomainError("PAYMENT_AMOUNT_MISMATCH", "El monto confirmado no coincide con el total esperado");
    }
    this.confirmedAmountValue = amount;
    this.confirmedAtValue = cloneDate(at);
    this.statusValue = TransactionPaymentStatus.PAID;
  }

  reject(): void {
    if (this.statusValue !== TransactionPaymentStatus.UNDER_REVIEW) {
      throw new DomainError("PAYMENT_NOT_UNDER_REVIEW", "El pago debe estar en revision");
    }
    this.statusValue = TransactionPaymentStatus.REJECTED;
  }

  markOverdue(at = new Date()): void {
    if (this.statusValue === TransactionPaymentStatus.OVERDUE) return;
    if (this.statusValue !== TransactionPaymentStatus.IN_CREDIT || !this.dueDate || this.dueDate.getTime() >= at.getTime()) {
      throw new DomainError("PAYMENT_NOT_OVERDUE", "El pago no cumple las condiciones para marcarse vencido");
    }
    this.statusValue = TransactionPaymentStatus.OVERDUE;
  }
}
