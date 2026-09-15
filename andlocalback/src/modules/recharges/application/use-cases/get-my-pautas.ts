import { PautaQueryView, Phase7QueryPort } from "../ports/phase7-query.ports";
import { requiredQueryId } from "./phase7-query.validation";

export class GetMyPautas {
  constructor(private readonly queries: Phase7QueryPort) {}

  execute(input: Readonly<{ clientId: string }>): Promise<readonly PautaQueryView[]> {
    return this.queries.listPautasByClient(requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio"));
  }
}
