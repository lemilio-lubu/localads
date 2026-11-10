import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import {
  InvoiceAuthorizationPersistencePort,
  InvoiceAuthorizationRequest,
  InvoiceClaim,
  InvoiceDocumentSource,
} from "../../application/ports/invoice-issuer.ports";
import { InvoiceStatus } from "../../domain/model/domain-status";
import { AccountType } from "../../domain/recharge.types";
import { decimalToMonetaryAmount } from "./prisma-multi-recharge.repository";

const platformNames: Record<string, string> = { META: "Meta", GOOGLE: "Google", TIKTOK: "TikTok" };

const requestSelect = {
  id: true, invoiceNumber: true, status: true, issuedAt: true, authorizationNumber: true, authorizedAt: true, externalReference: true, fiscalNumber: true,
  pautaSubtotal: true, isdAmount: true, agencyFeeAmount: true, vatBaseAmount: true, vatAmount: true, totalAmount: true,
  transaction: {
    select: {
      code: true,
      clientId: true,
      accountTypeSnapshot: true,
      creditDaysSnapshot: true,
      client: { select: { name: true, ruc: true, email: true, address: true, phone: true, managerId: true } },
      details: {
        select: { platformSnapshot: true, requestedAmount: true, vatBaseAmount: true, vatAmount: true, totalAmount: true },
        orderBy: { id: "asc" as const },
      },
    },
  },
} as const;

@Injectable()
export class PrismaInvoiceAuthorizationRepository implements InvoiceAuthorizationPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  /* Reserva atómica: el UPDATE condicionado bloquea la fila y PostgreSQL
     reevalúa la condición tras el bloqueo, así que de varios procesos
     simultáneos solo uno ve count = 1. */
  async claimForAuthorization(invoiceId: string, now: Date, claimUntil: Date): Promise<InvoiceClaim> {
    const claimed = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, status: InvoiceStatus.ISSUED, authorizationNumber: null, OR: [{ authorizationClaimedUntil: null }, { authorizationClaimedUntil: { lte: now } }] },
      data: { authorizationClaimedUntil: claimUntil },
    });
    const record = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: requestSelect });
    if (!record) return { kind: "NOT_FOUND" };
    if (record.authorizationNumber) return { kind: "ALREADY_AUTHORIZED" };
    if (record.status === InvoiceStatus.MANUAL) return { kind: "MANUAL" };
    if (claimed.count !== 1) return { kind: "IN_PROGRESS" };
    return { kind: "CLAIMED", request: toRequest(record) };
  }

  async markAuthorized(command: Parameters<InvoiceAuthorizationPersistencePort["markAuthorized"]>[0]): Promise<void> {
    await this.prisma.invoice.update({
      where: { id: command.invoiceId },
      data: {
        authorizationNumber: command.authorization.authorizationNumber,
        authorizedAt: command.authorization.authorizedAt,
        fiscalNumber: command.authorization.fiscalNumber,
        externalReference: command.externalReference,
        issuer: command.issuer,
        documentUrl: command.documentUrl,
        authorizationClaimedUntil: null,
        authorizationError: null,
        version: { increment: 1 },
      },
    });
  }

  /* Solo si sigue sin autorizar: un proceso rezagado no deshace una
     autorización que otro ya guardó. */
  async markSubmitted(command: Parameters<InvoiceAuthorizationPersistencePort["markSubmitted"]>[0]): Promise<void> {
    await this.prisma.invoice.updateMany({
      where: { id: command.invoiceId, authorizationNumber: null },
      data: {
        issuer: command.issuer,
        externalReference: command.externalReference,
        fiscalNumber: command.fiscalNumber,
        authorizationClaimedUntil: null,
        authorizationError: command.error?.slice(0, 500) ?? null,
        version: { increment: 1 },
      },
    });
  }

  async releaseAfterFailure(command: Readonly<{ invoiceId: string; reason: string }>): Promise<void> {
    await this.prisma.invoice.updateMany({
      where: { id: command.invoiceId, authorizationNumber: null },
      data: { authorizationClaimedUntil: null, authorizationError: command.reason.slice(0, 500) },
    });
  }

  async listPendingAuthorization(now: Date, limit: number): Promise<readonly string[]> {
    const records = await this.prisma.invoice.findMany({
      where: { status: InvoiceStatus.ISSUED, authorizationNumber: null, OR: [{ authorizationClaimedUntil: null }, { authorizationClaimedUntil: { lte: now } }] },
      select: { id: true },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return records.map((record) => record.id);
  }

  async loadDocumentSource(invoiceId: string): Promise<InvoiceDocumentSource | null> {
    const record = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: requestSelect });
    if (!record) return null;
    return {
      request: toRequest(record),
      authorization: record.authorizationNumber && record.authorizedAt
        ? { authorizationNumber: record.authorizationNumber, authorizedAt: record.authorizedAt, fiscalNumber: record.fiscalNumber }
        : null,
      owner: { clientId: record.transaction.clientId, managerId: record.transaction.client.managerId },
    };
  }
}

type RequestRecord = Prisma.InvoiceGetPayload<{ select: typeof requestSelect }>;

function toRequest(record: RequestRecord): InvoiceAuthorizationRequest {
  const { client, accountTypeSnapshot, creditDaysSnapshot } = record.transaction;
  const postpaid = accountTypeSnapshot === AccountType.POSTPAID;
  return {
    invoiceId: record.id,
    invoiceNumber: record.invoiceNumber,
    transactionCode: record.transaction.code,
    issuedAt: record.issuedAt,
    customer: { name: client.name, ruc: client.ruc, email: client.email, address: client.address, phone: client.phone },
    lines: record.transaction.details.map((detail) => ({
      platform: detail.platformSnapshot,
      description: `Recarga publicitaria ${platformNames[detail.platformSnapshot] ?? detail.platformSnapshot}`,
      amount: decimalToMonetaryAmount(detail.requestedAmount),
      vatBaseAmount: decimalToMonetaryAmount(detail.vatBaseAmount),
      vatAmount: decimalToMonetaryAmount(detail.vatAmount),
      totalAmount: decimalToMonetaryAmount(detail.totalAmount),
    })),
    payment: { mode: postpaid ? "POSTPAID" : "PREPAID", creditDays: postpaid ? creditDaysSnapshot : null },
    externalReference: record.externalReference,
    totals: {
      pautaAmount: decimalToMonetaryAmount(record.pautaSubtotal),
      isdAmount: decimalToMonetaryAmount(record.isdAmount),
      agencyFeeAmount: decimalToMonetaryAmount(record.agencyFeeAmount),
      vatBaseAmount: decimalToMonetaryAmount(record.vatBaseAmount),
      vatAmount: decimalToMonetaryAmount(record.vatAmount),
      totalAmount: decimalToMonetaryAmount(record.totalAmount),
    },
  };
}
