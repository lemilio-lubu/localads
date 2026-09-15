import { ApplicationError } from "../../../../common/errors/application.error";
import { ClientTransactionDetailView, Phase7QueryPort } from "../ports/phase7-query.ports";
import { requiredQueryId } from "./phase7-query.validation";

export class GetMyTransactionDetail {
  constructor(private readonly queries: Phase7QueryPort) {}

  async execute(input: Readonly<{ clientId: string; transactionId: string }>): Promise<ClientTransactionDetailView> {
    const clientId = requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio");
    const transactionId = requiredQueryId(input.transactionId, "TRANSACTION_REQUIRED", "La transaccion es obligatoria");
    const detail = await this.queries.findTransactionDetailByClient({ clientId, transactionId });
    if (!detail) throw new ApplicationError("TRANSACTION_NOT_FOUND", "La transaccion no existe", 404);
    return detail;
  }
}
