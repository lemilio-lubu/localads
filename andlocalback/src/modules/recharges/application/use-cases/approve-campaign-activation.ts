import { IdGenerator } from "../ports/recharge.ports";
import { CampaignActivationPersistencePort, CampaignActivationRequestView } from "../ports/campaign-activation.ports";
import { assertActivationRequestOpen, requireActivationRequest, requiredText } from "./campaign-activation.validation";

export type ApproveCampaignActivationCommand = Readonly<{ requestId: string; administratorId: string }>;

export class ApproveCampaignActivation {
  constructor(
    private readonly persistence: CampaignActivationPersistencePort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: ApproveCampaignActivationCommand): Promise<CampaignActivationRequestView> {
    const requestId = requiredText(command.requestId, "ACTIVATION_REQUEST_REQUIRED", "La solicitud es obligatoria");
    const administratorId = requiredText(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    const request = requireActivationRequest(await this.persistence.findById(requestId));
    assertActivationRequestOpen(request);
    return this.persistence.approve({
      requestId,
      administratorId,
      expectedVersion: request.version,
      decidedAt: new Date(),
      pautaId: this.ids.generate(),
    });
  }
}
