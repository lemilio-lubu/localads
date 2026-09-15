import { ApplicationError } from "../../../../common/errors/application.error";
import { AccountStatus, AccountType, AdvertisingPlatform, CampaignStatus, ClientStatus } from "../recharge.types";

export type Campaign = { id: string; platform: AdvertisingPlatform; status: CampaignStatus };
export type Client = { id: string; status: ClientStatus };

export class Account {
  constructor(
    public readonly id: string,
    public readonly client: Client,
    public readonly status: AccountStatus,
    public readonly type: AccountType,
    public readonly campaigns: Campaign[],
    public readonly creditDays = 0,
    public readonly creditLimit = 0,
    public creditUsed = 0,
  ) {
    if (!Object.values(AccountType).includes(type)) {
      throw new ApplicationError("INVALID_ACCOUNT_TYPE", "La cuenta debe tener exactamente un tipo: PREPAGO o POSTPAGO");
    }
  }

  reserveCredit(amount: number) {
    if (this.type !== AccountType.POSTPAID) {
      throw new ApplicationError("INVALID_PAYMENT_FLOW", "La cuenta no pertenece al flujo postpago", 409);
    }
    if (amount > this.creditLimit - this.creditUsed) {
      throw new ApplicationError("INSUFFICIENT_CREDIT", "El cupo de crédito disponible es insuficiente", 409);
    }
    this.creditUsed += amount;
  }

  get creditAvailable() { return this.creditLimit - this.creditUsed; }

  assertCanRecharge(requiredType: AccountType) {
    if (this.client.status !== ClientStatus.ACTIVE) {
      throw new ApplicationError("CLIENT_INACTIVE", "El cliente no está activo", 409);
    }
    if (this.status !== AccountStatus.ACTIVE) {
      throw new ApplicationError("ACCOUNT_INACTIVE", "La cuenta no está activa", 409);
    }
    if (this.type !== requiredType) {
      throw new ApplicationError("ACCOUNT_TYPE_MISMATCH", `La cuenta no es de tipo ${requiredType}`, 409);
    }
  }

  activeCampaignFor(platform: AdvertisingPlatform) {
    const campaign = this.campaigns.find((item) => item.platform === platform && item.status === CampaignStatus.ACTIVE);
    if (!campaign) {
      throw new ApplicationError("ACTIVE_CAMPAIGN_NOT_FOUND", `No existe una pauta ${platform} activa`, 409);
    }
    return campaign;
  }
}
