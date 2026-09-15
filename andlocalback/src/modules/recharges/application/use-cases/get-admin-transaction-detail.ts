import { ApplicationError } from "../../../../common/errors/application.error";
import { AdminTransactionDetailView, Phase7QueryPort } from "../ports/phase7-query.ports";
import { requiredQueryId } from "./phase7-query.validation";

export class GetAdminTransactionDetail {
  constructor(private readonly queries: Phase7QueryPort) {}

  async execute(input: Readonly<{ transactionId: string }>): Promise<AdminTransactionDetailView> {
    const transactionId = requiredQueryId(input.transactionId, "TRANSACTION_REQUIRED", "La transaccion es obligatoria");
    const detail = await this.queries.findTransactionDetail(transactionId);
    if (!detail) throw new ApplicationError("TRANSACTION_NOT_FOUND", "La transaccion no existe", 404);
    return detail;
  }
}
