import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { ActivationRequestStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import {
  AdminCampaignActivationRequestsController,
  CampaignActivationRequestsController,
} from "../src/modules/recharges/presentation/campaign-activation-requests.controller";
import {
  CampaignActivationRejectionDto,
  CampaignActivationReviewDecisionDto,
  CreateCampaignActivationRequestDto,
  ListAdminCampaignActivationRequestsQueryDto,
} from "../src/modules/recharges/presentation/dto/campaign-activation-request.dto";

describe("Fase 6 - DTO de solicitud de activacion", () => {
  it("acepta una solicitud valida, transforma espacios y elimina campos controlados por backend", async () => {
    const dto = plainToInstance(CreateCampaignActivationRequestDto, {
      accountId: " account-001 ",
      platform: AdvertisingPlatform.TIKTOK,
      requesterName: " Ana Perez ",
      externalAccountId: " tt-987 ",
      phone: " +593 99 123 4567 ",
      firstRechargeAmount: "200.50",
      clientId: "client-forged",
      status: ActivationRequestStatus.APPROVED,
      pautaId: "pauta-forged",
    });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto).toEqual({
      accountId: "account-001",
      platform: AdvertisingPlatform.TIKTOK,
      requesterName: "Ana Perez",
      externalAccountId: "tt-987",
      phone: "+593 99 123 4567",
      firstRechargeAmount: "200.50",
    });
  });

  it.each([0, "0", "0.00", "-1", "1.001", "texto"])(
    "rechaza el monto invalido %s",
    async (firstRechargeAmount) => {
      const dto = plainToInstance(CreateCampaignActivationRequestDto, {
        accountId: "account-001",
        platform: AdvertisingPlatform.META,
        requesterName: "Ana Perez",
        externalAccountId: "meta-123",
        phone: "+593991234567",
        firstRechargeAmount,
      });
      expect(await validate(dto)).not.toEqual([]);
    },
  );

  it.each(["WHATSAPP", "", undefined])("rechaza la plataforma %s", async (platform) => {
    const dto = plainToInstance(CreateCampaignActivationRequestDto, {
      accountId: "account-001",
      platform,
      requesterName: "Ana Perez",
      externalAccountId: "external-123",
      phone: "+593991234567",
      firstRechargeAmount: "100.00",
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  it("valida administrador, motivo y filtro de estado", async () => {
    const decision = plainToInstance(CampaignActivationReviewDecisionDto, {
      administratorId: " ",
      pautaId: "forged",
    });
    const rejection = plainToInstance(CampaignActivationRejectionDto, {
      administratorId: "admin-1",
      reason: "x",
    });
    const filter = plainToInstance(ListAdminCampaignActivationRequestsQueryDto, {
      status: "UNKNOWN",
    });

    expect(await validate(decision)).not.toEqual([]);
    expect(await validate(rejection)).not.toEqual([]);
    expect(await validate(filter)).not.toEqual([]);
  });
});

describe("Fase 6 - endpoints de activacion", () => {
  function setup() {
    const requestActivation = { execute: vi.fn(async (command) => ({ id: "activation-1", ...command })) };
    const listClient = { execute: vi.fn(async () => []) };
    const listAdmin = { execute: vi.fn(async () => []) };
    const review = { execute: vi.fn(async () => ({ status: ActivationRequestStatus.IN_REVIEW })) };
    const approve = { execute: vi.fn(async () => ({ status: ActivationRequestStatus.APPROVED })) };
    const reject = { execute: vi.fn(async () => ({ status: ActivationRequestStatus.REJECTED })) };

    const clientController = new CampaignActivationRequestsController(
      requestActivation as never,
      listClient as never,
    );
    const adminController = new AdminCampaignActivationRequestsController(
      listAdmin as never,
      review as never,
      approve as never,
      reject as never,
    );
    return { clientController, adminController, requestActivation, listClient, listAdmin, review, approve, reject };
  }

  it("crea la solicitud resolviendo identidad mediante accountId", async () => {
    const { clientController, requestActivation } = setup();
    await clientController.request({
      accountId: "account-001",
      platform: AdvertisingPlatform.TIKTOK,
      requesterName: "Ana Perez",
      externalAccountId: "tt-987",
      phone: "+593991234567",
      firstRechargeAmount: "200.50",
    });

    expect(requestActivation.execute).toHaveBeenCalledWith({
      accountId: "account-001",
      platform: AdvertisingPlatform.TIKTOK,
      requesterName: "Ana Perez",
      externalAccountId: "tt-987",
      phone: "+593991234567",
      firstRechargeAmount: 200.5,
    });
  });

  it("lista solo las solicitudes resueltas desde la cuenta del cliente", async () => {
    const { clientController, listClient } = setup();
    await clientController.listOwn({ accountId: "account-001" });
    expect(listClient.execute).toHaveBeenCalledWith({ accountId: "account-001" });
  });

  it("lista administrativamente con estado opcional", async () => {
    const { adminController, listAdmin } = setup();
    await adminController.list({ status: ActivationRequestStatus.IN_REVIEW });
    expect(listAdmin.execute).toHaveBeenCalledWith({ status: ActivationRequestStatus.IN_REVIEW });
  });

  it("mapea revision, aprobacion y rechazo sin aceptar pautaId ni status", async () => {
    const { adminController, review, approve, reject } = setup();
    await adminController.review("activation-1", { administratorId: "admin-1" });
    await adminController.approve("activation-1", { administratorId: "admin-2" });
    await adminController.reject("activation-1", { administratorId: "admin-3", reason: "Datos invalidos" });

    expect(review.execute).toHaveBeenCalledWith({ requestId: "activation-1", administratorId: "admin-1" });
    expect(approve.execute).toHaveBeenCalledWith({ requestId: "activation-1", administratorId: "admin-2" });
    expect(reject.execute).toHaveBeenCalledWith({
      requestId: "activation-1",
      administratorId: "admin-3",
      reason: "Datos invalidos",
    });
  });
});
