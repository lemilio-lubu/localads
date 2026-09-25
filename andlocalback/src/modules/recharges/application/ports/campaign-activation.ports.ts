import { ActivationRequestStatus, PautaStatus } from "../../domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../../domain/recharge.types";

export type CampaignActivationContext = Readonly<{
  client: Readonly<{ id: string; status: ClientStatus }> | null;
  account: Readonly<{
    id: string;
    clientId: string;
    status: AccountStatus;
    type: AccountType;
  }> | null;
  pauta: Readonly<{
    id: string;
    clientId: string;
    platform: AdvertisingPlatform;
    status: PautaStatus;
  }> | null;
  openRequest: CampaignActivationRequestView | null;
}>;

export type CampaignActivationAccountContext = Readonly<{
  client: CampaignActivationContext["client"];
  account: CampaignActivationContext["account"];
}>;

export type CampaignActivationRequestView = Readonly<{
  kind?: "ACTIVATION" | "REACTIVATION";
  id: string;
  clientId: string;
  platform: AdvertisingPlatform;
  requesterName: string;
  externalAccountId: string;
  phone: string;
  firstRechargeAmount: number;
  status: ActivationRequestStatus;
  reviewedBy: string | null;
  /* Nombre del interno que tiene la solicitud. El id suelto -«auth-admin»- no
     le dice nada a nadie, y sin el dos administradores pueden estar dentro del
     mismo caso sin saberlo. */
  reviewedByName: string | null;
  /* El cliente al que pertenece la solicitud, por nombre y RUC. El id
     interno no le dice a quien revisa de qué cliente se trata. Opcionales:
     solo los rellenan las lecturas que los resuelven. */
  clientName?: string | null;
  clientRuc?: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  pautaId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CreatedCampaignActivationRequest = Readonly<{
  id: string;
  clientId: string;
  platform: AdvertisingPlatform;
  requesterName: string;
  externalAccountId: string;
  phone: string;
  firstRechargeAmount: string;
}>;

export type CampaignActivationDecision = Readonly<{
  requestId: string;
  administratorId: string;
  expectedVersion: number;
  decidedAt: Date;
}>;

export type ApproveCampaignActivationDecision = CampaignActivationDecision & Readonly<{
  pautaId: string;
}>;

export type RejectCampaignActivationDecision = CampaignActivationDecision & Readonly<{
  reason: string;
}>;

export type CampaignActivationListFilters = Readonly<{
  /* Recorte del gestor, tomado del token. Ausente = admin, sin limite. */
  managerId?: string;
  /* Filtro del admin: solicitudes de clientes sin gestor. */
  unassigned?: boolean;
  status?: ActivationRequestStatus;
  clientId?: string;
}>;

/**
 * Persistence boundary for first-pauta activation. Mutation methods must use
 * expectedVersion as a compare-and-swap guard. create and approve are atomic:
 * create enforces one open request per client/platform; approve creates exactly
 * one ACTIVE pauta and links it to the approved request.
 */
export interface CampaignActivationPersistencePort {
  loadAccountContext(accountId: string): Promise<CampaignActivationAccountContext>;
  loadRequestContext(accountId: string, platform: AdvertisingPlatform): Promise<CampaignActivationContext>;
  create(request: CreatedCampaignActivationRequest): Promise<CampaignActivationRequestView>;
  findById(requestId: string): Promise<CampaignActivationRequestView | null>;
  startReview(decision: CampaignActivationDecision): Promise<CampaignActivationRequestView>;
  approve(decision: ApproveCampaignActivationDecision): Promise<CampaignActivationRequestView>;
  reject(decision: RejectCampaignActivationDecision): Promise<CampaignActivationRequestView>;
  list(filters: CampaignActivationListFilters): Promise<readonly CampaignActivationRequestView[]>;
}

export const CAMPAIGN_ACTIVATION_PERSISTENCE = Symbol("CAMPAIGN_ACTIVATION_PERSISTENCE");
