import { RechargeRepository } from "../../application/ports/recharge.ports";
import { Recharge } from "../../domain/entities/recharge";

export class InMemoryRechargeRepository implements RechargeRepository {
  private readonly recharges = new Map<string, Recharge>();

  async save(recharge: Recharge) {
    this.recharges.set(recharge.props.id, recharge);
  }

  async findById(id: string) {
    return this.recharges.get(id) ?? null;
  }
}
