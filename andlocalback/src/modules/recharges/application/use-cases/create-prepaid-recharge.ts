import { ApplicationError } from "../../../../common/errors/application.error";
import { Recharge } from "../../domain/entities/recharge";
import { AccountType, AdvertisingPlatform, ReceiptUpload } from "../../domain/recharge.types";
import { Money } from "../../domain/value-objects/money";
import { AccountRepository, IdGenerator, OcrProcessor, ReceiptProcessor, RechargeRepository, TransactionRealtimePublisher } from "../ports/recharge.ports";

const minimumOcrConfidence = 80;

export type CreatePrepaidRechargeCommand = {
  accountId: string;
  platform: AdvertisingPlatform;
  amount: number;
  receipt?: ReceiptUpload;
};

export class CreatePrepaidRecharge {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly recharges: RechargeRepository,
    private readonly receiptProcessor: ReceiptProcessor,
    private readonly ocrProcessor: OcrProcessor,
    private readonly ids: IdGenerator,
    private readonly realtime: TransactionRealtimePublisher = { publish: () => undefined },
  ) {}

  async execute(command: CreatePrepaidRechargeCommand) {
    const account = await this.accounts.findById(command.accountId);
    if (!account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);

    account.assertCanRecharge(AccountType.PREPAID);
    const campaign = account.activeCampaignFor(command.platform);
    const amount = Money.fromAmount(command.amount);
    if (!command.receipt) throw new ApplicationError("RECEIPT_REQUIRED", "La cuenta prepago requiere un comprobante");

    // El original se persiste antes del OCR para conservarlo incluso si el motor falla.
    const receipt = await this.receiptProcessor.process(command.receipt);
    const recharge = new Recharge({
      id: this.ids.generate(), accountId: account.id, accountType: account.type,
      campaignId: campaign.id, platform: command.platform, amount, receipts: [receipt], createdAt: new Date(),
    });

    try {
      recharge.submitPrepaidForReview(await this.ocrProcessor.process(command.receipt), minimumOcrConfidence);
    } catch (error) {
      recharge.recordOcrFailure(error instanceof Error ? error.message : "Error técnico no identificado durante el OCR");
    }

    await this.recharges.save(recharge);
    const result = recharge.toPrimitives();
    this.realtime.publish({ change: "CREATED", transaction: result });
    return result;
  }
}
