import { ActivationRequestStatus } from "../../domain/model/domain-status";
import { CampaignActivationPersistencePort, CampaignActivationRequestView } from "../ports/campaign-activation.ports";

export type ListPendingCampaignActivationsQuery = Readonly<{ status?: ActivationRequestStatus; managerId?: string; unassigned?: boolean }>;

export class ListPendingCampaignActivations {
  constructor(private readonly persistence: CampaignActivationPersistencePort) {}

  execute(query: ListPendingCampaignActivationsQuery = {}): Promise<readonly CampaignActivationRequestView[]> {
    const status = query.status ?? ActivationRequestStatus.PENDING;
    return this.persistence.list({ status, managerId: query.managerId?.trim() || undefined, unassigned: query.unassigned });
  }
}
