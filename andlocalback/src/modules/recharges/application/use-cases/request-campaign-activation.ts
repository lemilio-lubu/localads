import { ApplicationError } from "../../../../common/errors/application.error";
import { ActivationRequest } from "../../domain/entities/activation-request";
import { PautaStatus } from "../../domain/model/domain-status";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { AccountStatus, AdvertisingPlatform, ClientStatus } from "../../domain/recharge.types";
import { IdGenerator } from "../ports/recharge.ports";
import {
  CampaignActivationPersistencePort,
  CampaignActivationRequestView,
} from "../ports/campaign-activation.ports";
import { requiredText } from "./campaign-activation.validation";

export type RequestCampaignActivationCommand = Readonly<{
  clientId?: string;
  accountId: string;
  platform: AdvertisingPlatform;
  requesterName: string;
  externalAccountId: string;
  phone: string;
  firstRechargeAmount: number;
}>;

export class RequestCampaignActivation {
  constructor(
    private readonly persistence: CampaignActivationPersistencePort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: RequestCampaignActivationCommand): Promise<CampaignActivationRequestView> {
    const accountId = requiredText(command.accountId, "ACCOUNT_REQUIRED", "La cuenta es obligatoria");
    if (command.clientId !== undefined) requiredText(command.clientId, "CLIENT_REQUIRED", "El cliente no puede estar vacio");
    if (!Object.values(AdvertisingPlatform).includes(command.platform)) {
      throw new ApplicationError("UNSUPPORTED_PLATFORM", "La plataforma no esta soportada");
    }

    const context = await this.persistence.loadRequestContext(accountId, command.platform);
    if (!context.account) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    if (!context.client) throw new ApplicationError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    if (context.account.clientId !== context.client.id) {
      throw new ApplicationError("INVALID_ACCOUNT_CONTEXT", "La cuenta no coincide con su cliente", 409);
    }
    if (command.clientId !== undefined && context.client.id !== command.clientId) {
      throw new ApplicationError("ACCOUNT_NOT_OWNED", "La cuenta no pertenece al cliente", 409);
    }

    if (context.client.status !== ClientStatus.ACTIVE) {
      throw new ApplicationError("CLIENT_INACTIVE", "El cliente no esta activo", 409);
    }
    if (context.account.status !== AccountStatus.ACTIVE) {
      throw new ApplicationError("ACCOUNT_INACTIVE", "La cuenta no esta activa", 409);
    }
    if (context.pauta) {
      if (context.pauta.status === PautaStatus.ACTIVE) {
        throw new ApplicationError("PAUTA_ALREADY_ACTIVE", `El cliente ya tiene una pauta ${command.platform} activa`, 409);
      }
      if (context.pauta.status !== PautaStatus.INACTIVE) throw new ApplicationError(
        "PAUTA_REACTIVATION_REQUIRED",
        `La pauta ${command.platform} requiere revisión administrativa antes de reactivarse`,
        409,
      );
    }
    if (context.openRequest) {
      throw new ApplicationError(
        "ACTIVATION_REQUEST_DUPLICATE",
        `Ya existe una solicitud ${command.platform} pendiente o en revision`,
        409,
      );
    }

    let firstRechargeAmount: MonetaryAmount;
    try {
      firstRechargeAmount = MonetaryAmount.fromMajorUnits(command.firstRechargeAmount);
      if (firstRechargeAmount.isZero) throw new Error("zero");
    } catch {
      throw new ApplicationError("INVALID_AMOUNT", "El monto de primera recarga debe ser mayor que cero y tener maximo dos decimales");
    }

    const request = new ActivationRequest({
      id: this.ids.generate(),
      clientId: context.client.id,
      platform: command.platform,
      requesterName: requiredText(command.requesterName, "REQUESTER_NAME_REQUIRED", "El nombre del solicitante es obligatorio"),
      externalAccountId: requiredText(command.externalAccountId, "EXTERNAL_ACCOUNT_ID_REQUIRED", "El ID de cuenta externa es obligatorio"),
      phone: requiredText(command.phone, "PHONE_REQUIRED", "El telefono es obligatorio"),
      firstRechargeAmount,
    });

    return this.persistence.create({
      id: request.props.id,
      clientId: request.props.clientId,
      platform: request.props.platform,
      requesterName: request.props.requesterName,
      externalAccountId: request.props.externalAccountId,
      phone: request.props.phone,
      firstRechargeAmount: request.props.firstRechargeAmount.toMajorUnits(),
    });
  }
}
