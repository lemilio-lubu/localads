import { Phase7QueryPort, WalletOverviewView } from "../ports/phase7-query.ports";
import { requiredQueryId } from "./phase7-query.validation";

export class GetWalletOverview {
  constructor(private readonly queries: Phase7QueryPort) {}

  async execute(input: Readonly<{ clientId: string }>): Promise<WalletOverviewView> {
    const clientId = requiredQueryId(input.clientId, "CLIENT_REQUIRED", "El cliente es obligatorio");
    const pautas = await this.queries.listPautasByClient(clientId);
    const cents = pautas.reduce((total, pauta) => total + Math.round(pauta.currentBalance * 100), 0);
    return { balanceTotal: cents / 100, pautas };
  }
}
