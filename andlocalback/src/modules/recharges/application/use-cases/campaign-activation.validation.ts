import { ApplicationError } from "../../../../common/errors/application.error";
import { ActivationRequestStatus } from "../../domain/model/domain-status";
import { CampaignActivationRequestView } from "../ports/campaign-activation.ports";

export function requiredText(value: string, code: string, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApplicationError(code, message);
  }
  return value.trim();
}

export function requireActivationRequest(
  request: CampaignActivationRequestView | null,
): CampaignActivationRequestView {
  if (!request) {
    throw new ApplicationError("ACTIVATION_REQUEST_NOT_FOUND", "La solicitud de activacion no existe", 404);
  }
  return request;
}

export function assertActivationRequestOpen(request: CampaignActivationRequestView): void {
  if (request.status !== ActivationRequestStatus.PENDING && request.status !== ActivationRequestStatus.IN_REVIEW) {
    throw new ApplicationError("ACTIVATION_REQUEST_ALREADY_RESOLVED", "La solicitud de activacion ya fue resuelta", 409);
  }
}
