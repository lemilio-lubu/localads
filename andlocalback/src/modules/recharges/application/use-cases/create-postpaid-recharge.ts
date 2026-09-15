import { ApplicationError } from "../../../../common/errors/application.error";
import { Recharge } from "../../domain/entities/recharge";
import { AccountType, AdvertisingPlatform } from "../../domain/recharge.types";
import { Money } from "../../domain/value-objects/money";
import { AccountRepository, IdGenerator, RechargeRepository, TransactionRealtimePublisher } from "../ports/recharge.ports";

export type CreatePostpaidRechargeCommand = {
  accountId: string;
  platform: AdvertisingPlatform;
  amount: number;
};

export class CreatePostpaidRecharge {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly recharges: RechargeRepository,
    private readonly ids: IdGenerator,
    private readonly realtime: TransactionRealtimePublisher = { publish: () => undefined },
  ) {}

  async execute(command: CreatePostpaidRechargeCommand) {
    const account = await this.accounts.findById(command.accountId);
    if (!account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);

    account.assertCanRecharge(AccountType.POSTPAID);
    const campaign = account.activeCampaignFor(command.platform);
    const amount = Money.fromAmount(command.amount);
    account.reserveCredit(amount.toAmount());
    const recharge = new Recharge({
      id: this.ids.generate(),
      accountId: account.id,
      accountType: account.type,
      campaignId: campaign.id,
      platform: command.platform,
      amount,
      createdAt: new Date(),
    });

    recharge.approvePostpaid(`${recharge.props.id}-obligation`, account.creditDays);
    await this.recharges.save(recharge);
    await this.accounts.save?.(account);
    const result = recharge.toPrimitives();
    this.realtime.publish({ change: "CREATED", transaction: result });
    return result;
  }
}
