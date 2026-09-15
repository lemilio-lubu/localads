import { ApplicationError } from "../../../../common/errors/application.error";
import { RechargeRepository, TransactionRealtimePublisher } from "../ports/recharge.ports";

export class ApprovePrepaidVerification {
  constructor(private readonly recharges: RechargeRepository, private readonly realtime: TransactionRealtimePublisher = { publish: () => undefined }) {}

  async execute(rechargeId: string, administratorId: string) {
    const recharge = await this.recharges.findById(rechargeId);
    if (!recharge) throw new ApplicationError("RECHARGE_NOT_FOUND", "La recarga no existe", 404);
    recharge.approvePrepaidVerification(administratorId);
    await this.recharges.save(recharge);
    const result = recharge.toPrimitives();
    this.realtime.publish({ change: "UPDATED", transaction: result });
    return result;
  }
}
