import { AdvertisingPlatform } from "../recharge.types";
import { assertNonEmpty, cloneDate } from "../core/assertions";
import { DomainError } from "../core/domain-error";
import { ActivationRequestStatus } from "../model/domain-status";
import { MonetaryAmount } from "../value-objects/monetary-amount";

export type CreateActivationRequestProps = Readonly<{
  id: string;
  clientId: string;
  platform: AdvertisingPlatform;
  requesterName: string;
  externalAccountId: string;
  phone: string;
  firstRechargeAmount: MonetaryAmount;
  createdAt?: Date;
}>;

export class ActivationRequest {
  public readonly createdAt: Date;
  private statusValue = ActivationRequestStatus.PENDING;
  private reviewedByValue: string | null = null;
  private reviewedAtValue: Date | null = null;
  private rejectionReasonValue: string | null = null;
  private pautaIdValue: string | null = null;

  constructor(public readonly props: CreateActivationRequestProps) {
    assertNonEmpty(props.id, "solicitudActivacionId");
    assertNonEmpty(props.clientId, "clientId");
    assertNonEmpty(props.requesterName, "nombreSolicitante");
    assertNonEmpty(props.externalAccountId, "idCuentaExterna");
    assertNonEmpty(props.phone, "telefono");
    if (!Object.values(AdvertisingPlatform).includes(props.platform)) {
      throw new DomainError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
    }
    if (props.firstRechargeAmount.isZero) {
      throw new DomainError("INVALID_AMOUNT", "El monto de primera recarga debe ser mayor que cero");
    }
    this.createdAt = cloneDate(props.createdAt ?? new Date());
  }

  get status(): ActivationRequestStatus { return this.statusValue; }
  get reviewedBy(): string | null { return this.reviewedByValue; }
  get reviewedAt(): Date | null { return this.reviewedAtValue ? cloneDate(this.reviewedAtValue) : null; }
  get rejectionReason(): string | null { return this.rejectionReasonValue; }
  get pautaId(): string | null { return this.pautaIdValue; }

  startReview(administratorId: string, at = new Date()): void {
    this.assertStatus(ActivationRequestStatus.PENDING);
    assertNonEmpty(administratorId, "administradorId");
    this.statusValue = ActivationRequestStatus.IN_REVIEW;
    this.reviewedByValue = administratorId;
    this.reviewedAtValue = cloneDate(at);
  }

  approve(administratorId: string, pautaId: string, at = new Date()): void {
    if (this.statusValue !== ActivationRequestStatus.PENDING && this.statusValue !== ActivationRequestStatus.IN_REVIEW) {
      throw new DomainError("ACTIVATION_REQUEST_ALREADY_RESOLVED", "La solicitud ya fue resuelta");
    }
    assertNonEmpty(administratorId, "administradorId");
    assertNonEmpty(pautaId, "pautaId");
    this.statusValue = ActivationRequestStatus.APPROVED;
    this.reviewedByValue = administratorId;
    this.reviewedAtValue = cloneDate(at);
    this.pautaIdValue = pautaId;
  }

  reject(administratorId: string, reason: string, at = new Date()): void {
    if (this.statusValue !== ActivationRequestStatus.PENDING && this.statusValue !== ActivationRequestStatus.IN_REVIEW) {
      throw new DomainError("ACTIVATION_REQUEST_ALREADY_RESOLVED", "La solicitud ya fue resuelta");
    }
    assertNonEmpty(administratorId, "administradorId");
    assertNonEmpty(reason, "motivo");
    this.statusValue = ActivationRequestStatus.REJECTED;
    this.reviewedByValue = administratorId;
    this.reviewedAtValue = cloneDate(at);
    this.rejectionReasonValue = reason;
  }

  private assertStatus(expected: ActivationRequestStatus): void {
    if (this.statusValue !== expected) {
      throw new DomainError("INVALID_ACTIVATION_TRANSITION", `La solicitud debe estar ${expected}`);
    }
  }
}
