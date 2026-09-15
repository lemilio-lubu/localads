import { CampaignActivationPersistencePort, CampaignActivationRequestView } from "../ports/campaign-activation.ports";
import { assertActivationRequestOpen, requireActivationRequest, requiredText } from "./campaign-activation.validation";

export type RejectCampaignActivationCommand = Readonly<{ requestId: string; administratorId: string; reason: string }>;

export class RejectCampaignActivation {
  constructor(private readonly persistence: CampaignActivationPersistencePort) {}

  async execute(command: RejectCampaignActivationCommand): Promise<CampaignActivationRequestView> {
    const requestId = requiredText(command.requestId, "ACTIVATION_REQUEST_REQUIRED", "La solicitud es obligatoria");
    const administratorId = requiredText(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    const reason = requiredText(command.reason, "REJECTION_REASON_REQUIRED", "El motivo del rechazo es obligatorio");
    const request = requireActivationRequest(await this.persistence.findById(requestId));
    assertActivationRequestOpen(request);
    return this.persistence.reject({
      requestId,
      administratorId,
      reason,
      expectedVersion: request.version,
      decidedAt: new Date(),
    });
  }
}
