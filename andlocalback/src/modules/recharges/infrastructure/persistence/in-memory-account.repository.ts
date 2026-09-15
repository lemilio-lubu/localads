import { AccountRepository } from "../../application/ports/recharge.ports";
import { Account } from "../../domain/entities/account";
import { AccountStatus, AccountType, AdvertisingPlatform, CampaignStatus, ClientStatus } from "../../domain/recharge.types";

export class InMemoryAccountRepository implements AccountRepository {
  private readonly accounts = new Map<string, Account>([
    [
      "account-prepaid-001",
      new Account(
        "account-prepaid-001",
        { id: "client-001", status: ClientStatus.ACTIVE },
        AccountStatus.ACTIVE,
        AccountType.PREPAID,
        [
          { id: "campaign-meta-001", platform: AdvertisingPlatform.META, status: CampaignStatus.ACTIVE },
          { id: "campaign-google-001", platform: AdvertisingPlatform.GOOGLE, status: CampaignStatus.ACTIVE },
        ],
      ),
    ],
    [
      "account-postpaid-001",
      new Account(
        "account-postpaid-001",
        { id: "client-002", status: ClientStatus.ACTIVE },
        AccountStatus.ACTIVE,
        AccountType.POSTPAID,
        [
          { id: "campaign-meta-postpaid-001", platform: AdvertisingPlatform.META, status: CampaignStatus.ACTIVE },
          { id: "campaign-google-postpaid-001", platform: AdvertisingPlatform.GOOGLE, status: CampaignStatus.ACTIVE },
        ],
        5,
        1_000,
      ),
    ],
  ]);

  async findById(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async save(account: Account) {
    this.accounts.set(account.id, account);
  }
}
