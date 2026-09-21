import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApplicationError } from "../../../../common/errors/application.error";
import { PrismaService } from "../../../../database/prisma.service";
import {
  ApproveCampaignActivationDecision,
  CampaignActivationAccountContext,
  CampaignActivationContext,
  CampaignActivationDecision,
  CampaignActivationListFilters,
  CampaignActivationPersistencePort,
  CampaignActivationRequestView,
  CreatedCampaignActivationRequest,
  RejectCampaignActivationDecision,
} from "../../application/ports/campaign-activation.ports";
import { ActivationRequestStatus, PautaStatus } from "../../domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../../domain/recharge.types";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";

const OPEN_STATUSES = [ActivationRequestStatus.PENDING, ActivationRequestStatus.IN_REVIEW] as const;

@Injectable()
export class PrismaCampaignActivationRepository implements CampaignActivationPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async loadAccountContext(accountId: string): Promise<CampaignActivationAccountContext> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        clientId: true,
        status: true,
        type: true,
        client: { select: { id: true, status: true } },
      },
    });
    if (!account) return { account: null, client: null };
    return {
      account: {
        id: account.id,
        clientId: account.clientId,
        status: account.status as AccountStatus,
        type: account.type as AccountType,
      },
      client: { id: account.client.id, status: account.client.status as ClientStatus },
    };
  }

  async loadRequestContext(
    accountId: string,
    platform: AdvertisingPlatform,
  ): Promise<CampaignActivationContext> {
    const ownership = await this.loadAccountContext(accountId);
    if (!ownership.account || !ownership.client) {
      return { ...ownership, pauta: null, openRequest: null };
    }
    const [pauta, openRequest] = await Promise.all([
      this.prisma.pauta.findUnique({
        where: { clientId_platform: { clientId: ownership.client.id, platform } },
        select: { id: true, clientId: true, platform: true, status: true },
      }),
      this.prisma.campaignActivationRequest.findFirst({
        where: { clientId: ownership.client.id, platform, status: { in: [...OPEN_STATUSES] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      ...ownership,
      pauta: pauta ? {
        id: pauta.id,
        clientId: pauta.clientId,
        platform: pauta.platform as AdvertisingPlatform,
        status: pauta.status as PautaStatus,
      } : null,
      openRequest: openRequest ? toView(openRequest) : null,
    };
  }

  async create(request: CreatedCampaignActivationRequest): Promise<CampaignActivationRequestView> {
    const activeRequestKey = requestKey(request.clientId, request.platform);
    try {
      return await this.prisma.$transaction(async (database) => {
        const pauta = await database.pauta.findUnique({
          where: { clientId_platform: { clientId: request.clientId, platform: request.platform } },
          select: { id: true, status: true, externalAccountId: true },
        });
        if (pauta && pauta.status !== PautaStatus.INACTIVE) throw pautaAlreadyExists();
        if (pauta?.externalAccountId && pauta.externalAccountId !== request.externalAccountId) throw new ApplicationError("EXTERNAL_ACCOUNT_MISMATCH", "La reactivación debe conservar el ID de la cuenta existente", 409);

        const saved = await database.campaignActivationRequest.create({
          data: {
            id: request.id,
            clientId: request.clientId,
            platform: request.platform,
            requesterName: request.requesterName,
            externalAccountId: request.externalAccountId,
            phone: request.phone,
            firstRechargeAmount: new Prisma.Decimal(request.firstRechargeAmount),
            status: ActivationRequestStatus.PENDING,
            kind: pauta ? "REACTIVATION" : "ACTIVATION",
            pautaId: pauta?.id,
            activeRequestKey,
          },
        });
        return toView(saved);
      });
    } catch (error: unknown) {
      if (isUniqueError(error) || isConcurrentWriteError(error)) {
        const existingPauta = await this.prisma.pauta.findUnique({
          where: { clientId_platform: { clientId: request.clientId, platform: request.platform } },
          select: { id: true, status: true },
        });
        if (existingPauta && existingPauta.status !== PautaStatus.INACTIVE) throw pautaAlreadyExists();
        const existingRequest = await this.prisma.campaignActivationRequest.findFirst({
          where: { activeRequestKey },
          select: { id: true },
        });
        if (existingRequest) throw duplicateRequest();
        throw error;
      }
      throw mapConcurrentDecision(error);
    }
  }

  async findById(requestId: string): Promise<CampaignActivationRequestView | null> {
    const record = await this.prisma.campaignActivationRequest.findUnique({ where: { id: requestId } });
    return record ? toView(record) : null;
  }

  async startReview(decision: CampaignActivationDecision): Promise<CampaignActivationRequestView> {
    try {
      const updated = await this.prisma.campaignActivationRequest.updateMany({
        where: {
          id: decision.requestId,
          version: decision.expectedVersion,
          status: ActivationRequestStatus.PENDING,
          activeRequestKey: { not: null },
        },
        data: {
          status: ActivationRequestStatus.IN_REVIEW,
          reviewedBy: decision.administratorId,
          reviewedAt: decision.decidedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw alreadyResolved();
      return await this.requireById(decision.requestId);
    } catch (error: unknown) {
      throw mapConcurrentDecision(error);
    }
  }

  async approve(decision: ApproveCampaignActivationDecision): Promise<CampaignActivationRequestView> {
    try {
      return await this.prisma.$transaction(async (database) => {
        const request = await database.campaignActivationRequest.findUnique({
          where: { id: decision.requestId },
        });
        if (!request) throw new ApplicationError("ACTIVATION_REQUEST_NOT_FOUND", "La solicitud de activacion no existe", 404);
        if (request.version !== decision.expectedVersion || !isOpen(request.status) || !request.activeRequestKey) {
          throw alreadyResolved();
        }
        const client = await database.client.findUnique({ where: { id: request.clientId }, include: { accounts: { select: { status: true } } } });
        if (!client || client.status !== "ACTIVE" || !client.accounts.some((account) => account.status === "ACTIVE")) throw new ApplicationError("CLIENT_INACTIVE", "El cliente y su cuenta deben estar activos", 409);
        const existingPauta = await database.pauta.findUnique({
          where: { clientId_platform: { clientId: request.clientId, platform: request.platform } },
          select: { id: true, status: true, activatedAt: true, externalAccountId: true },
        });
        if (existingPauta && existingPauta.status !== PautaStatus.INACTIVE) throw pautaAlreadyExists();

        const pauta = await database.pauta.upsert({
          where: { clientId_platform: { clientId: request.clientId, platform: request.platform } },
          update: { status: PautaStatus.ACTIVE, externalAccountId: existingPauta?.externalAccountId ?? request.externalAccountId, activatedAt: existingPauta?.activatedAt ?? decision.decidedAt, version: { increment: 1 } },
          create: {
            id: decision.pautaId,
            clientId: request.clientId,
            platform: request.platform,
            externalAccountId: request.externalAccountId,
            status: PautaStatus.ACTIVE,
            currentBalance: new Prisma.Decimal(0),
            activatedAt: decision.decidedAt,
          },
        });
        const updated = await database.campaignActivationRequest.updateMany({
          where: {
            id: request.id,
            version: decision.expectedVersion,
            status: { in: [...OPEN_STATUSES] },
            activeRequestKey: request.activeRequestKey,
          },
          data: {
            pautaId: pauta.id,
            status: ActivationRequestStatus.APPROVED,
            activeRequestKey: null,
            reviewedBy: decision.administratorId,
            reviewedAt: decision.decidedAt,
            rejectionReason: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw alreadyResolved();
        await database.client.update({ where: { id: request.clientId }, data: { platformsVersion: { increment: 1 } } });
        await database.platformLifecycleAudit.create({ data: { clientId: request.clientId, pautaId: pauta.id, action: existingPauta ? "REACTIVATE" : "ACTIVATE", actorId: decision.administratorId } });
        const saved = await database.campaignActivationRequest.findUniqueOrThrow({ where: { id: request.id } });
        return toView(saved);
      });
    } catch (error: unknown) {
      if (isUniqueError(error)) {
        const current = await this.findById(decision.requestId);
        if (!current || !isOpen(current.status) || current.version !== decision.expectedVersion) throw alreadyResolved();
        throw pautaAlreadyExists();
      }
      throw mapConcurrentDecision(error);
    }
  }

  async reject(decision: RejectCampaignActivationDecision): Promise<CampaignActivationRequestView> {
    try {
      const updated = await this.prisma.campaignActivationRequest.updateMany({
        where: {
          id: decision.requestId,
          version: decision.expectedVersion,
          status: { in: [...OPEN_STATUSES] },
          activeRequestKey: { not: null },
        },
        data: {
          status: ActivationRequestStatus.REJECTED,
          activeRequestKey: null,
          reviewedBy: decision.administratorId,
          reviewedAt: decision.decidedAt,
          rejectionReason: decision.reason,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw alreadyResolved();
      return await this.requireById(decision.requestId);
    } catch (error: unknown) {
      throw mapConcurrentDecision(error);
    }
  }

  async list(filters: CampaignActivationListFilters): Promise<readonly CampaignActivationRequestView[]> {
    const records = await this.prisma.campaignActivationRequest.findMany({
      // El recorte va por la relacion con el cliente: la solicitud es de un
      // cliente, y el gestor solo ve las de su cartera.
      where: { status: filters.status, clientId: filters.clientId, ...(filters.managerId ? { client: { is: { managerId: filters.managerId } } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return records.map(toView);
  }

  private async requireById(requestId: string): Promise<CampaignActivationRequestView> {
    const record = await this.findById(requestId);
    if (!record) throw new ApplicationError("ACTIVATION_REQUEST_NOT_FOUND", "La solicitud de activacion no existe", 404);
    return record;
  }
}

type ActivationRecord = Prisma.CampaignActivationRequestGetPayload<Record<string, never>>;

function toView(record: ActivationRecord): CampaignActivationRequestView {
  return {
    id: record.id,
    clientId: record.clientId,
    platform: record.platform as AdvertisingPlatform,
    requesterName: record.requesterName,
    externalAccountId: record.externalAccountId ?? "",
    phone: record.phone,
    firstRechargeAmount: MonetaryAmount.fromMajorUnits(record.firstRechargeAmount.toString()).toSafeNumber(),
    status: record.status as ActivationRequestStatus,
    reviewedBy: record.reviewedBy,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    rejectionReason: record.rejectionReason,
    pautaId: record.pautaId,
    kind: record.kind as "ACTIVATION" | "REACTIVATION",
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requestKey(clientId: string, platform: AdvertisingPlatform): string {
  return `${clientId}:${platform}`;
}

function isOpen(status: string): boolean {
  return status === ActivationRequestStatus.PENDING || status === ActivationRequestStatus.IN_REVIEW;
}

function duplicateRequest(): ApplicationError {
  return new ApplicationError(
    "ACTIVATION_REQUEST_DUPLICATE",
    "Ya existe una solicitud pendiente o en revision para esta plataforma",
    409,
  );
}

function pautaAlreadyExists(): ApplicationError {
  return new ApplicationError(
    "PAUTA_ALREADY_EXISTS",
    "Ya existe una pauta para el cliente y la plataforma",
    409,
  );
}

function alreadyResolved(): ApplicationError {
  return new ApplicationError(
    "ACTIVATION_REQUEST_ALREADY_RESOLVED",
    "La solicitud de activacion ya fue resuelta o modificada por otro administrador",
    409,
  );
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapConcurrentDecision(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P1008", "P2025", "P2028", "P2034"].includes(error.code)) {
    return alreadyResolved();
  }
  return error;
}

function isConcurrentWriteError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P1008", "P2028", "P2034"].includes(error.code);
}
