import { ApplicationError } from "../../../../common/errors/application.error";
import { CampaignActivationPersistencePort, CampaignActivationRequestView } from "../ports/campaign-activation.ports";
import { requiredText } from "./campaign-activation.validation";

export type ListClientCampaignActivationsQuery = Readonly<{ accountId: string; clientId?: string }>;

export class ListClientCampaignActivations {
  constructor(private readonly persistence: CampaignActivationPersistencePort) {}

  async execute(query: ListClientCampaignActivationsQuery): Promise<readonly CampaignActivationRequestView[]> {
    const accountId = requiredText(query.accountId, "ACCOUNT_REQUIRED", "La cuenta es obligatoria");
    const context = await this.persistence.loadAccountContext(accountId);
    if (!context.account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    if (!context.client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    if (context.account.clientId !== context.client.id) {
      throw new ApplicationError("INVALID_ACCOUNT_CONTEXT", "La cuenta no coincide con su cliente", 409);
    }
    if (query.clientId !== undefined && query.clientId !== context.client.id) {
      throw new ApplicationError("ACCOUNT_NOT_OWNED", "La cuenta no pertenece al cliente", 409);
    }
    return this.persistence.list({ clientId: context.client.id });
  }
}
