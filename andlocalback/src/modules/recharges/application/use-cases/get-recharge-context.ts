import { ApplicationError } from "../../../../common/errors/application.error";
import { Phase7QueryPort, RechargeContextView } from "../ports/phase7-query.ports";
import { requiredQueryId } from "./phase7-query.validation";

/**
 * Entrega el contexto que el formulario de recarga necesita para que el cliente
 * vea, antes de confirmar, cuanto pagara y de cuanto credito dispone.
 */
export class GetRechargeContext {
  constructor(private readonly queries: Phase7QueryPort) {}

  async execute(input: Readonly<{ clientId: string }>): Promise<RechargeContextView> {
    const clientId = requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio");
    const context = await this.queries.getRechargeContext(clientId);
    if (!context) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    return context;
  }
}
