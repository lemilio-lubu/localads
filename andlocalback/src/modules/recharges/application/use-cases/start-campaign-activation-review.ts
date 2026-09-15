import { ApplicationError } from "../../../../common/errors/application.error";
import { ActivationRequestStatus } from "../../domain/model/domain-status";
import { CampaignActivationPersistencePort, CampaignActivationRequestView } from "../ports/campaign-activation.ports";
import { requireActivationRequest, requiredText } from "./campaign-activation.validation";

export type StartCampaignActivationReviewCommand = Readonly<{ requestId: string; administratorId: string }>;

export class StartCampaignActivationReview {
  constructor(private readonly persistence: CampaignActivationPersistencePort) {}

  async execute(command: StartCampaignActivationReviewCommand): Promise<CampaignActivationRequestView> {
    const requestId = requiredText(command.requestId, "ACTIVATION_REQUEST_REQUIRED", "La solicitud es obligatoria");
    const administratorId = requiredText(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    const request = requireActivationRequest(await this.persistence.findById(requestId));
    if (request.status !== ActivationRequestStatus.PENDING) {
      throw new ApplicationError("INVALID_ACTIVATION_TRANSITION", "Solo una solicitud pendiente puede pasar a revision", 409);
    }
    return this.persistence.startReview({ requestId, administratorId, expectedVersion: request.version, decidedAt: new Date() });
  }
}
