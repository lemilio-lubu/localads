import { AdvertisingPlatform } from "../recharge.types";
import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { TransactionDetailStatus } from "../model/domain-status";
import { AndPricingBreakdown, AndPricingPolicy } from "../policies/and-pricing.policy";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type PautaSnapshot = Readonly<{
  pautaId: string;
  platform: AdvertisingPlatform;
  externalAccountId: string | null;
}>;

export type CreateTransactionDetailProps = Readonly<{
  id: string;
  pauta: PautaSnapshot;
  requestedAmount: MonetaryAmount;
  createdAt?: Date;
}>;

export class TransactionDetail {
  public readonly id: string;
  public readonly pautaSnapshot: PautaSnapshot;
  public readonly pricing: AndPricingBreakdown;
  public readonly createdAt: Date;
  private statusValue = TransactionDetailStatus.REQUESTED;
  private effectiveAmountValue: MonetaryAmount | null = null;
  private completedAtValue: Date | null = null;

  private constructor(props: CreateTransactionDetailProps, pricingPolicy: AndPricingPolicy) {
    assertNonEmpty(props.id, "detalleTransaccionId");
    assertNonEmpty(props.pauta.pautaId, "pautaId");
    if (!Object.values(AdvertisingPlatform).includes(props.pauta.platform)) {
      throw new DomainError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
    }
    if (props.requestedAmount.isZero) {
      throw new DomainError("INVALID_AMOUNT", "El monto de cada pauta debe ser mayor que cero");
    }

    this.id = props.id;
    this.pautaSnapshot = Object.freeze({ ...props.pauta });
    this.pricing = pricingPolicy.calculate(props.requestedAmount);
    this.createdAt = cloneDate(props.createdAt ?? new Date());
  }

  static create(props: CreateTransactionDetailProps, pricingPolicy = new AndPricingPolicy()): TransactionDetail {
    return new TransactionDetail(props, pricingPolicy);
  }

  get status(): TransactionDetailStatus { return this.statusValue; }
  get effectiveAmount(): MonetaryAmount | null { return this.effectiveAmountValue; }
  get completedAt(): Date | null { return this.completedAtValue ? cloneDate(this.completedAtValue) : null; }

  approve(): void {
    this.assertStatus(TransactionDetailStatus.REQUESTED);
    this.statusValue = TransactionDetailStatus.APPROVED;
  }

  startProcessing(): void {
    this.assertStatus(TransactionDetailStatus.APPROVED);
    this.statusValue = TransactionDetailStatus.PROCESSING;
  }

  complete(effectiveAmount: MonetaryAmount, at = new Date()): void {
    if (this.statusValue === TransactionDetailStatus.COMPLETED) {
      if (this.effectiveAmountValue?.equals(effectiveAmount)) return;
      throw new DomainError(
        "TRANSACTION_DETAIL_ALREADY_COMPLETED",
        "El detalle ya fue completado con otros datos efectivos",
      );
    }
    this.assertStatus(TransactionDetailStatus.PROCESSING);
    if (effectiveAmount.isZero) {
      throw new DomainError("INVALID_EFFECTIVE_AMOUNT", "El monto recargado debe ser mayor que cero");
    }
    this.effectiveAmountValue = effectiveAmount;
    this.completedAtValue = cloneDate(at);
    this.statusValue = TransactionDetailStatus.COMPLETED;
  }

  private assertStatus(expected: TransactionDetailStatus): void {
    if (this.statusValue !== expected) {
      throw new DomainError("INVALID_DETAIL_TRANSITION", `El detalle debe estar ${expected}`);
    }
  }
}
