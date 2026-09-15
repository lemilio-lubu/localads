import { AdvertisingPlatform } from "../recharge.types";
import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { PautaStatus } from "../model/domain-status";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type PautaProps = Readonly<{
  id: string;
  clientId: string;
  platform: AdvertisingPlatform;
  externalAccountId: string | null;
  status: PautaStatus;
  currentBalance: MonetaryAmount;
  activatedAt: Date | null;
  createdAt: Date;
  completedRechargeDetailIds?: readonly string[];
}>;

export class Pauta {
  private statusValue: PautaStatus;
  private balanceValue: MonetaryAmount;
  private activatedAtValue: Date | null;
  private readonly completedDetails: Set<string>;

  constructor(public readonly props: PautaProps) {
    assertNonEmpty(props.id, "pautaId");
    assertNonEmpty(props.clientId, "clientId");
    if (!Object.values(AdvertisingPlatform).includes(props.platform)) {
      throw new DomainError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
    }
    if (!Object.values(PautaStatus).includes(props.status)) {
      throw new DomainError("INVALID_PAUTA_STATUS", "El estado de la pauta no es valido");
    }
    this.statusValue = props.status;
    this.balanceValue = props.currentBalance;
    this.activatedAtValue = props.activatedAt ? cloneDate(props.activatedAt) : null;
    this.completedDetails = new Set(props.completedRechargeDetailIds ?? []);
  }

  get status(): PautaStatus { return this.statusValue; }
  get currentBalance(): MonetaryAmount { return this.balanceValue; }
  get activatedAt(): Date | null { return this.activatedAtValue ? cloneDate(this.activatedAtValue) : null; }

  activate(at = new Date()): void {
    if (this.statusValue === PautaStatus.ACTIVE) return;
    this.statusValue = PautaStatus.ACTIVE;
    this.activatedAtValue ??= cloneDate(at);
  }

  deactivate(): void {
    this.assertStatus(PautaStatus.ACTIVE, "Solo una pauta activa puede desactivarse");
    this.statusValue = PautaStatus.INACTIVE;
  }

  suspend(): void {
    if (this.statusValue !== PautaStatus.ACTIVE && this.statusValue !== PautaStatus.INACTIVE) {
      throw new DomainError("INVALID_PAUTA_TRANSITION", "La pauta no puede suspenderse desde su estado actual");
    }
    this.statusValue = PautaStatus.SUSPENDED;
  }

  assertCanReceiveRecharge(): void {
    if (this.statusValue !== PautaStatus.ACTIVE) {
      throw new DomainError("PAUTA_NOT_ACTIVE", `La pauta ${this.props.platform} no esta activa`);
    }
  }

  /** Credits balance only as the consequence of a completed transaction detail. */
  recordCompletedRecharge(detailId: string, effectiveAmount: MonetaryAmount): void {
    assertNonEmpty(detailId, "detalleTransaccionId");
    if (effectiveAmount.isZero) {
      throw new DomainError("INVALID_EFFECTIVE_AMOUNT", "El monto efectivo debe ser mayor que cero");
    }
    if (this.completedDetails.has(detailId)) return;
    this.balanceValue = this.balanceValue.add(effectiveAmount);
    this.completedDetails.add(detailId);
  }

  hasAppliedRecharge(detailId: string): boolean {
    return this.completedDetails.has(detailId);
  }

  private assertStatus(expected: PautaStatus, message: string): void {
    if (this.statusValue !== expected) throw new DomainError("INVALID_PAUTA_TRANSITION", message);
  }
}
