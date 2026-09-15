import { describe, expect, it, vi } from "vitest";
import { ApproveCampaignActivation } from "../src/modules/recharges/application/use-cases/approve-campaign-activation";
import { ListClientCampaignActivations } from "../src/modules/recharges/application/use-cases/list-client-campaign-activations";
import { ListPendingCampaignActivations } from "../src/modules/recharges/application/use-cases/list-pending-campaign-activations";
import { RejectCampaignActivation } from "../src/modules/recharges/application/use-cases/reject-campaign-activation";
import { RequestCampaignActivation } from "../src/modules/recharges/application/use-cases/request-campaign-activation";
import { StartCampaignActivationReview } from "../src/modules/recharges/application/use-cases/start-campaign-activation-review";
import {
  CampaignActivationPersistencePort,
  CampaignActivationRequestView,
} from "../src/modules/recharges/application/ports/campaign-activation.ports";
import { ActivationRequestStatus, PautaStatus } from "../src/modules/recharges/domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../src/modules/recharges/domain/recharge.types";

const baseView: CampaignActivationRequestView = {
  id: "activation-1",
  clientId: "client-1",
  platform: AdvertisingPlatform.TIKTOK,
  requesterName: "Ana Perez",
  externalAccountId: "tt-123",
  phone: "0999999999",
  firstRechargeAmount: 100,
  status: ActivationRequestStatus.PENDING,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  pautaId: null,
  version: 0,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

function persistence(overrides: Partial<CampaignActivationPersistencePort> = {}): CampaignActivationPersistencePort {
  return {
    loadAccountContext: vi.fn().mockResolvedValue({
      client: { id: "client-1", status: ClientStatus.ACTIVE },
      account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
    }),
    loadRequestContext: vi.fn().mockResolvedValue({
      client: { id: "client-1", status: ClientStatus.ACTIVE },
      account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
      pauta: null,
      openRequest: null,
    }),
    create: vi.fn().mockResolvedValue(baseView),
    findById: vi.fn().mockResolvedValue(baseView),
    startReview: vi.fn().mockResolvedValue({ ...baseView, status: ActivationRequestStatus.IN_REVIEW, version: 1 }),
    approve: vi.fn().mockResolvedValue({ ...baseView, status: ActivationRequestStatus.APPROVED, pautaId: "pauta-1", version: 1 }),
    reject: vi.fn().mockResolvedValue({ ...baseView, status: ActivationRequestStatus.REJECTED, rejectionReason: "Datos invalidos", version: 1 }),
    list: vi.fn().mockResolvedValue([baseView]),
    ...overrides,
  };
}

const command = {
  accountId: "account-1",
  platform: AdvertisingPlatform.TIKTOK,
  requesterName: " Ana Perez ",
  externalAccountId: " tt-123 ",
  phone: " 0999999999 ",
  firstRechargeAmount: 100,
};

describe("Fase 6 - primera pauta", () => {
  it("crea una solicitud PENDING sin crear pauta, transaccion ni pago", async () => {
    const repo = persistence();
    const result = await new RequestCampaignActivation(repo, { generate: () => "activation-1" }).execute(command);

    expect(result.status).toBe(ActivationRequestStatus.PENDING);
    expect(repo.create).toHaveBeenCalledWith({
      id: "activation-1",
      clientId: "client-1",
      platform: AdvertisingPlatform.TIKTOK,
      requesterName: "Ana Perez",
      externalAccountId: "tt-123",
      phone: "0999999999",
      firstRechargeAmount: "100.00",
    });
  });

  it.each([
    ["cliente inexistente", { client: null }, "CLIENT_NOT_FOUND"],
    ["cliente inactivo", { client: { id: "client-1", status: ClientStatus.INACTIVE } }, "CLIENT_INACTIVE"],
    ["cuenta inexistente", { account: null }, "ACCOUNT_NOT_FOUND"],
    ["cuenta inactiva", { account: { id: "account-1", clientId: "client-1", status: AccountStatus.INACTIVE, type: AccountType.PREPAID } }, "ACCOUNT_INACTIVE"],
  ])("rechaza %s", async (_label, changed, code) => {
    const repo = persistence({
      loadRequestContext: vi.fn().mockResolvedValue({
        client: { id: "client-1", status: ClientStatus.ACTIVE },
        account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
        pauta: null,
        openRequest: null,
        ...changed,
      }),
    });
    await expect(new RequestCampaignActivation(repo, { generate: () => "id" }).execute(command))
      .rejects.toMatchObject({ code });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rechaza una solicitud duplicada y conserva la existente", async () => {
    const repo = persistence({
      loadRequestContext: vi.fn().mockResolvedValue({
        client: { id: "client-1", status: ClientStatus.ACTIVE },
        account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
        pauta: null,
        openRequest: baseView,
      }),
    });
    await expect(new RequestCampaignActivation(repo, { generate: () => "id" }).execute(command))
      .rejects.toMatchObject({ code: "ACTIVATION_REQUEST_DUPLICATE", status: 409 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    [PautaStatus.ACTIVE, "PAUTA_ALREADY_ACTIVE"],
    [PautaStatus.SUSPENDED, "PAUTA_REACTIVATION_REQUIRED"],
  ])("no trata una pauta %s como primera activacion", async (status, code) => {
    const repo = persistence({
      loadRequestContext: vi.fn().mockResolvedValue({
        client: { id: "client-1", status: ClientStatus.ACTIVE },
        account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
        pauta: { id: "pauta-1", clientId: "client-1", platform: AdvertisingPlatform.TIKTOK, status },
        openRequest: null,
      }),
    });
    await expect(new RequestCampaignActivation(repo, { generate: () => "id" }).execute(command))
      .rejects.toMatchObject({ code });
  });

  it.each([0, -1, 10.001])("rechaza monto inicial invalido: %s", async (firstRechargeAmount) => {
    await expect(new RequestCampaignActivation(persistence(), { generate: () => "id" }).execute({
      ...command,
      firstRechargeAmount,
    })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("solo inicia revision desde PENDING usando CAS", async () => {
    const repo = persistence();
    await new StartCampaignActivationReview(repo).execute({ requestId: "activation-1", administratorId: "admin-1" });
    expect(repo.startReview).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "activation-1", administratorId: "admin-1", expectedVersion: 0,
    }));

    const resolved = persistence({ findById: vi.fn().mockResolvedValue({ ...baseView, status: ActivationRequestStatus.IN_REVIEW }) });
    await expect(new StartCampaignActivationReview(resolved).execute({ requestId: "activation-1", administratorId: "admin-1" }))
      .rejects.toMatchObject({ code: "INVALID_ACTIVATION_TRANSITION" });
  });

  it("aprueba PENDING o IN_REVIEW y delega crear/vincular una sola pauta ACTIVE", async () => {
    const repo = persistence({ findById: vi.fn().mockResolvedValue({ ...baseView, status: ActivationRequestStatus.IN_REVIEW, version: 4 }) });
    const result = await new ApproveCampaignActivation(repo, { generate: () => "pauta-new" }).execute({
      requestId: "activation-1", administratorId: "admin-1",
    });
    expect(result.status).toBe(ActivationRequestStatus.APPROVED);
    expect(repo.approve).toHaveBeenCalledWith(expect.objectContaining({
      pautaId: "pauta-new", expectedVersion: 4, administratorId: "admin-1",
    }));
  });

  it("rechaza una solicitud abierta con motivo y CAS", async () => {
    const repo = persistence();
    const result = await new RejectCampaignActivation(repo).execute({
      requestId: "activation-1", administratorId: "admin-1", reason: " Datos invalidos ",
    });
    expect(result.status).toBe(ActivationRequestStatus.REJECTED);
    expect(repo.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: "Datos invalidos", expectedVersion: 0 }));
  });

  it.each([ActivationRequestStatus.APPROVED, ActivationRequestStatus.REJECTED])("no resuelve dos veces una solicitud %s", async (status) => {
    const repo = persistence({ findById: vi.fn().mockResolvedValue({ ...baseView, status }) });
    await expect(new ApproveCampaignActivation(repo, { generate: () => "pauta" }).execute({ requestId: "activation-1", administratorId: "admin" }))
      .rejects.toMatchObject({ code: "ACTIVATION_REQUEST_ALREADY_RESOLVED" });
    await expect(new RejectCampaignActivation(repo).execute({ requestId: "activation-1", administratorId: "admin", reason: "x" }))
      .rejects.toMatchObject({ code: "ACTIVATION_REQUEST_ALREADY_RESOLVED" });
  });

  it("lista solamente solicitudes del cliente dueño de la cuenta", async () => {
    const repo = persistence();
    await new ListClientCampaignActivations(repo).execute({ accountId: "account-1", clientId: "client-1" });
    expect(repo.list).toHaveBeenCalledWith({ clientId: "client-1" });
  });

  it("lista PENDING para administración por defecto y permite IN_REVIEW", async () => {
    const repo = persistence();
    const query = new ListPendingCampaignActivations(repo);
    await query.execute();
    await query.execute({ status: ActivationRequestStatus.IN_REVIEW });
    expect(repo.list).toHaveBeenNthCalledWith(1, { status: ActivationRequestStatus.PENDING });
    expect(repo.list).toHaveBeenNthCalledWith(2, { status: ActivationRequestStatus.IN_REVIEW });
  });
});
