import { ApplicationError } from "../../../../common/errors/application.error";

export class Money {
  private constructor(private readonly cents: number) {}

  static fromAmount(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApplicationError("INVALID_AMOUNT", "El monto debe ser mayor que cero");
    }

    const cents = Math.round(amount * 100);
    if (Math.abs(cents / 100 - amount) > Number.EPSILON) {
      throw new ApplicationError("INVALID_AMOUNT_PRECISION", "El monto admite máximo dos decimales");
    }

    return new Money(cents);
  }

  toAmount() {
    return this.cents / 100;
  }
}
