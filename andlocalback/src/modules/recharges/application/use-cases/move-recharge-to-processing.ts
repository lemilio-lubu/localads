import { ApplicationError } from "../../../../common/errors/application.error";
import { RechargeRepository, TransactionRealtimePublisher } from "../ports/recharge.ports";

export class MoveRechargeToProcessing {
  constructor(private readonly recharges: RechargeRepository, private readonly realtime: TransactionRealtimePublisher = { publish: () => undefined }) {}

  async execute(id: string) {
    const recharge = await this.recharges.findById(id);
    if (!recharge) throw new ApplicationError("RECHARGE_NOT_FOUND", "La recarga no existe", 404);
    recharge.moveToProcessing();
    await this.recharges.save(recharge);
    const result = recharge.toPrimitives();
    this.realtime.publish({ change: "UPDATED", transaction: result });
    return result;
  }
}
