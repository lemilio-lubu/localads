import { DomainError } from "../core/domain-error";

/**
 * Immutable monetary value stored as integer cents.
 * Arithmetic never uses floating point values.
 */
export class MonetaryAmount {
  private constructor(private readonly valueInCents: bigint) {
    if (valueInCents < 0n) {
      throw new DomainError("NEGATIVE_AMOUNT", "El monto no puede ser negativo");
    }
  }

  static zero(): MonetaryAmount {
    return new MonetaryAmount(0n);
  }

  static fromCents(cents: bigint | number): MonetaryAmount {
    if (typeof cents === "number") {
      if (!Number.isSafeInteger(cents)) {
        throw new DomainError("INVALID_AMOUNT", "Los centavos deben ser un entero seguro");
      }
      return new MonetaryAmount(BigInt(cents));
    }
    return new MonetaryAmount(cents);
  }

  static fromMajorUnits(amount: string | number): MonetaryAmount {
    const normalized = typeof amount === "number" ? MonetaryAmount.numberToDecimal(amount) : amount.trim();
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
    if (!match) {
      throw new DomainError("INVALID_AMOUNT_PRECISION", "El monto admite maximo dos decimales");
    }

    const whole = BigInt(match[1]);
    const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
    return new MonetaryAmount(whole * 100n + fraction);
  }

  get cents(): bigint {
    return this.valueInCents;
  }

  get isZero(): boolean {
    return this.valueInCents === 0n;
  }

  add(other: MonetaryAmount): MonetaryAmount {
    return new MonetaryAmount(this.valueInCents + other.valueInCents);
  }

  subtract(other: MonetaryAmount): MonetaryAmount {
    if (other.valueInCents > this.valueInCents) {
      throw new DomainError("NEGATIVE_AMOUNT", "La resta no puede producir un monto negativo");
    }
    return new MonetaryAmount(this.valueInCents - other.valueInCents);
  }

  /** Multiplies by numerator/denominator and rounds half up to a cent. */
  multiplyRatio(numerator: bigint | number, denominator: bigint | number): MonetaryAmount {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    if (n < 0n || d <= 0n) {
      throw new DomainError("INVALID_RATIO", "La proporcion debe ser positiva");
    }
    const product = this.valueInCents * n;
    return new MonetaryAmount((product + d / 2n) / d);
  }

  equals(other: MonetaryAmount): boolean {
    return this.valueInCents === other.valueInCents;
  }

  toMajorUnits(): string {
    const whole = this.valueInCents / 100n;
    const fraction = (this.valueInCents % 100n).toString().padStart(2, "0");
    return `${whole}.${fraction}`;
  }

  toSafeNumber(): number {
    const cents = Number(this.valueInCents);
    if (!Number.isSafeInteger(cents)) {
      throw new DomainError("UNSAFE_AMOUNT", "El monto excede la precision segura de JavaScript");
    }
    return cents / 100;
  }

  private static numberToDecimal(amount: number): string {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new DomainError("INVALID_AMOUNT", "El monto debe ser un numero no negativo");
    }
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - amount) > 1e-9) {
      throw new DomainError("INVALID_AMOUNT_PRECISION", "El monto admite maximo dos decimales");
    }
    return (cents / 100).toFixed(2);
  }
}
