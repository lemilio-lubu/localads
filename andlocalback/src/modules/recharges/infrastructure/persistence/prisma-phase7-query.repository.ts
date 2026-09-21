import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import {
  AdminTransactionDetailView,
  AdminTransactionFilters,
  AdminTransactionPage,
  ClientTransactionFilters,
  ClientTransactionDetailView,
  InvoiceQueryView,
  PageResult,
  PaymentReceiptClientView,
  VerificationFilters,
  VerificationListItemView,
  Phase7QueryPort,
  PautaQueryView,
  RechargeContextView,
  TransactionDetailQueryView,
  TransactionListItemView,
  TransactionPaymentQueryView,
  VerificationAdminView,
} from "../../application/ports/phase7-query.ports";
import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { AccountType, AdvertisingPlatform, VerificationIssue, VerificationStatus } from "../../domain/recharge.types";
import { AndPricingPolicy } from "../../domain/policies/and-pricing.policy";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { decimalToMonetaryAmount } from "./prisma-multi-recharge.repository";

const transactionListSelect = {
  id: true,
  code: true,
  clientId: true,
  client: { select: { name: true } },
  accountId: true,
  accountTypeSnapshot: true,
  rechargeStatus: true,
  pautaAmount: true,
  totalAmount: true,
  createdAt: true,
  details: { select: { platformSnapshot: true, pausedAt: true, status: true }, orderBy: { id: "asc" as const } },
  payment: { select: { status: true, dueDate: true } },
} satisfies Prisma.RechargeTransactionSelect;

const clientDetailSelect = {
  id: true,
  code: true,
  clientId: true,
  accountId: true,
  accountTypeSnapshot: true,
  creditDaysSnapshot: true,
  rechargeStatus: true,
  pautaAmount: true,
  isdAmount: true,
  agencyFeeAmount: true,
  vatBaseAmount: true,
  vatAmount: true,
  totalAmount: true,
  isdRateSnapshot: true,
  agencyFeeRateSnapshot: true,
  vatRateSnapshot: true,
  completedAt: true,
  createdAt: true,
  details: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], include: { pauta: { select: { status: true } } } },
  payment: {
    include: { receipts: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] } },
  },
  invoice: true,
  verifications: {
    select: { status: true, reviewReason: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
  },
} satisfies Prisma.RechargeTransactionSelect;

const adminDetailSelect = {
  ...clientDetailSelect,
  client: { select: { name: true } },
  verifications: {
    include: {
      receipt: true,
      ocrResult: true,
      decisionAudits: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
    },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  },
} satisfies Prisma.RechargeTransactionSelect;

type TransactionListRecord = Prisma.RechargeTransactionGetPayload<{ select: typeof transactionListSelect }>;
type ClientDetailRecord = Prisma.RechargeTransactionGetPayload<{ select: typeof clientDetailSelect }>;
type AdminDetailRecord = Prisma.RechargeTransactionGetPayload<{ select: typeof adminDetailSelect }>;

@Injectable()
export class PrismaPhase7QueryRepository implements Phase7QueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getRechargeContext(clientId: string): Promise<RechargeContextView | null> {
    const account = await this.prisma.account.findFirst({
      where: { clientId, status: "ACTIVE" },
      select: { id: true, type: true, creditDays: true, creditLimit: true, creditUsed: true },
      orderBy: { id: "asc" },
    });
    if (!account) return null;

    const limit = decimalToMonetaryAmount(account.creditLimit);
    const used = decimalToMonetaryAmount(account.creditUsed);
    // El disponible nunca es negativo: si lo usado supera al limite por un
    // ajuste manual, se informa cero en vez de una cifra sin sentido.
    const available = limit.cents > used.cents ? limit.subtract(used) : MonetaryAmount.zero();

    return {
      account: {
        id: account.id,
        type: account.type as AccountType,
        creditDays: account.creditDays,
        creditLimit: limit.toSafeNumber(),
        creditUsed: used.toSafeNumber(),
        creditAvailable: available.toSafeNumber(),
      },
      rates: {
        isd: AndPricingPolicy.ISD_RATE_BASIS_POINTS / 10_000,
        agencyFee: AndPricingPolicy.AGENCY_COMMISSION_RATE_BASIS_POINTS / 10_000,
        vat: AndPricingPolicy.VAT_RATE_BASIS_POINTS / 10_000,
      },
      pautas: await this.listPautasByClient(clientId),
    };
  }

  async listPautasByClient(clientId: string): Promise<readonly PautaQueryView[]> {
    const records = await this.prisma.pauta.findMany({
      where: { clientId },
      select: {
        id: true,
        platform: true,
        externalAccountId: true,
        status: true,
        currentBalance: true,
        activatedAt: true,
        transactionDetails: {
          where: { status: TransactionDetailStatus.COMPLETED },
          select: { effectiveRechargeDate: true, completedAt: true },
          orderBy: [{ effectiveRechargeDate: "desc" }, { completedAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ platform: "asc" }, { id: "asc" }],
    });

    return records.map((record) => ({
      id: record.id,
      platform: record.platform as AdvertisingPlatform,
      externalAccountId: record.externalAccountId,
      status: record.status as PautaStatus,
      currentBalance: money(record.currentBalance),
      activatedAt: iso(record.activatedAt),
      lastRechargeAt: iso(record.transactionDetails[0]?.effectiveRechargeDate ?? record.transactionDetails[0]?.completedAt),
    }));
  }

  async listTransactionsByClient(
    input: ClientTransactionFilters,
  ): Promise<PageResult<TransactionListItemView>> {
    // El cliente sale del token: el filtro nunca puede ampliarse a otro.
    return this.listTransactionPage({
      ...transactionSearch(input.search),
      clientId: input.clientId,
      rechargeStatus: input.rechargeStatus,
      payment: input.paymentStatus ? { is: { status: input.paymentStatus } } : undefined,
      createdAt: dateRange(input.dateFrom, input.dateTo),
    }, input.page, input.pageSize);
  }

  async findTransactionDetailByClient(
    input: { transactionId: string; clientId: string },
  ): Promise<ClientTransactionDetailView | null> {
    // Ownership is part of the database predicate: callers cannot distinguish
    // an unknown transaction from a transaction belonging to another client.
    const record = await this.prisma.rechargeTransaction.findFirst({
      where: { id: input.transactionId, clientId: input.clientId },
      select: clientDetailSelect,
    });
    return record ? toClientDetail(record) : null;
  }

  async listTransactions(input: AdminTransactionFilters): Promise<AdminTransactionPage> {
    const where: Prisma.RechargeTransactionWhereInput = {
      ...transactionSearch(input.search),
      ...managedClient(input.managerId),
      clientId: input.clientId,
      rechargeStatus: input.rechargeStatus,
      accountTypeSnapshot: input.accountType,
      payment: input.paymentStatus ? { is: { status: input.paymentStatus } } : undefined,
      createdAt: dateRange(input.dateFrom, input.dateTo),
    };
    // Los totales se agregan sobre el mismo predicado que la pagina, de modo que
    // el resumen describe el filtro completo y no solo las filas visibles.
    const [result, totals] = await Promise.all([
      this.listTransactionPage(where, input.page, input.pageSize),
      this.prisma.rechargeTransaction.aggregate({ where, _sum: { pautaAmount: true, totalAmount: true } }),
    ]);
    return {
      ...result,
      totals: {
        pautaAmount: money(totals._sum.pautaAmount ?? new Prisma.Decimal(0)),
        totalAmount: money(totals._sum.totalAmount ?? new Prisma.Decimal(0)),
      },
    };
  }

  /* findFirst y no findUnique: con el recorte del gestor la busqueda deja de
     ser por clave unica. Una transaccion ajena devuelve null, y el caso de uso
     la convierte en 404. */
  async findTransactionDetail(transactionId: string, managerId?: string): Promise<AdminTransactionDetailView | null> {
    const record = await this.prisma.rechargeTransaction.findFirst({
      where: { id: transactionId, ...managedClient(managerId) },
      select: adminDetailSelect,
    });
    return record ? toAdminDetail(record) : null;
  }

  async listVerifications(
    input: VerificationFilters,
  ): Promise<PageResult<VerificationListItemView>> {
    const search = input.search ? {
      OR: [
        { transaction: { is: { code: { contains: input.search } } } },
        { transaction: { is: { client: { is: { name: { contains: input.search } } } } } },
        { ocrResult: { is: { bank: { contains: input.search } } } },
        { ocrResult: { is: { detectedTransactionCode: { contains: input.search } } } },
      ],
    } satisfies Prisma.TransactionVerificationWhereInput : {};
    /* Cliente y gestor se combinan dentro del mismo filtro de relacion: dos
       claves `transaction` separadas se pisarian y el recorte desapareceria. */
    const transactionFilter: Prisma.RechargeTransactionWhereInput = {
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...managedClient(input.managerId),
    };
    const where: Prisma.TransactionVerificationWhereInput = {
      ...search,
      status: input.status ?? verificationStatusFilter(input.scope),
      transaction: Object.keys(transactionFilter).length ? { is: transactionFilter } : undefined,
      ocrResult: input.bank ? { is: { bank: { contains: input.bank } } } : undefined,
      createdAt: dateRange(input.dateFrom, input.dateTo),
    };
    const [records, totalItems] = await Promise.all([
      this.prisma.transactionVerification.findMany({
        where,
        select: {
          id: true,
          status: true,
          expectedAmount: true,
          detectedAmount: true,
          amountMatches: true,
          issues: true,
          receiptId: true,
          createdAt: true,
          decidedAt: true,
          decidedBy: true,
          reviewReason: true,
          receipt: { select: { mimeType: true } },
          ocrResult: { select: { bank: true, confidence: true, detectedTransactionCode: true } },
          transaction: { select: { id: true, code: true, clientId: true, pautaAmount: true, client: { select: { name: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset(input.page, input.pageSize),
        take: input.pageSize,
      }),
      this.prisma.transactionVerification.count({ where }),
    ]);

    const items: VerificationListItemView[] = records.map((record) => ({
      id: record.id,
      transactionId: record.transaction.id,
      transactionCode: record.transaction.code,
      clientId: record.transaction.clientId,
      clientName: record.transaction.client.name,
      status: record.status as VerificationStatus,
      requestedPautaAmount: money(record.transaction.pautaAmount),
      expectedTransferAmount: money(record.expectedAmount),
      detectedTransferAmount: nullableMoney(record.detectedAmount),
      amountDifference: record.detectedAmount === null ? null : money(record.detectedAmount.minus(record.expectedAmount)),
      amountMatches: record.amountMatches,
      bank: record.ocrResult?.bank ?? null,
      bankReference: record.ocrResult?.detectedTransactionCode ?? null,
      confidence: nullableNumber(record.ocrResult?.confidence),
      issues: parseIssues(record.issues),
      receiptId: record.receiptId,
      receiptContentUrl: `/api/v1/files/receipts/${record.receiptId}/content`,
      receiptMimeType: record.receipt.mimeType,
      decidedAt: iso(record.decidedAt),
      decidedBy: record.decidedBy,
      reviewReason: record.reviewReason,
      createdAt: record.createdAt.toISOString(),
    }));
    return page(items, input.page, input.pageSize, totalItems);
  }

  private async listTransactionPage(
    where: Prisma.RechargeTransactionWhereInput,
    pageNumber: number,
    pageSize: number,
  ): Promise<PageResult<TransactionListItemView>> {
    const [records, totalItems] = await Promise.all([
      this.prisma.rechargeTransaction.findMany({
        where,
        select: transactionListSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset(pageNumber, pageSize),
        take: pageSize,
      }),
      this.prisma.rechargeTransaction.count({ where }),
    ]);
    return page(records.map(toTransactionListItem), pageNumber, pageSize, totalItems);
  }
}

function toTransactionListItem(record: TransactionListRecord): TransactionListItemView {
  return {
    pausedDetails: record.details.filter((detail) => detail.pausedAt && !["COMPLETED", "REJECTED"].includes(detail.status)).length,
    id: record.id,
    code: record.code,
    clientId: record.clientId,
    clientName: record.client.name,
    accountId: record.accountId,
    accountTypeSnapshot: record.accountTypeSnapshot as AccountType,
    rechargeStatus: record.rechargeStatus as TransactionRechargeStatus,
    paymentStatus: record.payment?.status as TransactionPaymentStatus | undefined ?? null,
    pautaAmount: money(record.pautaAmount),
    totalAmount: money(record.totalAmount),
    platforms: record.details.map((detail) => detail.platformSnapshot as AdvertisingPlatform),
    dueDate: iso(record.payment?.dueDate),
    createdAt: record.createdAt.toISOString(),
  };
}

function toClientDetail(record: ClientDetailRecord): ClientTransactionDetailView {
  return {
    id: record.id,
    code: record.code,
    clientId: record.clientId,
    accountId: record.accountId,
    accountTypeSnapshot: record.accountTypeSnapshot as AccountType,
    creditDaysSnapshot: record.creditDaysSnapshot,
    rechargeStatus: record.rechargeStatus as TransactionRechargeStatus,
    pautaAmount: money(record.pautaAmount),
    isdAmount: money(record.isdAmount),
    agencyFeeAmount: money(record.agencyFeeAmount),
    vatBaseAmount: money(record.vatBaseAmount),
    vatAmount: money(record.vatAmount),
    totalAmount: money(record.totalAmount),
    isdRate: rate(record.isdRateSnapshot),
    agencyFeeRate: rate(record.agencyFeeRateSnapshot),
    vatRate: rate(record.vatRateSnapshot),
    completedAt: iso(record.completedAt),
    createdAt: record.createdAt.toISOString(),
    details: record.details.map(toDetail),
    payment: record.payment ? toPayment(record.payment) : null,
    invoice: record.invoice ? toInvoice(record.invoice) : null,
    verification: record.verifications[0] ? {
      status: record.verifications[0].status as VerificationStatus,
      reviewReason: record.verifications[0].reviewReason,
      updatedAt: record.verifications[0].updatedAt.toISOString(),
    } : null,
  };
}

function toAdminDetail(record: AdminDetailRecord): AdminTransactionDetailView {
  return {
    ...toClientDetail(record),
    clientName: record.client.name,
    verifications: record.verifications.map((verification) => toVerification(verification, record.pautaAmount)),
  };
}

function toDetail(record: ClientDetailRecord["details"][number]): TransactionDetailQueryView {
  return {
    version: record.version,
    pausedAt: ["COMPLETED", "REJECTED"].includes(record.status) ? null : iso(record.pausedAt),
    pautaStatus: record.pauta.status as PautaStatus,
    id: record.id,
    pautaId: record.pautaId,
    platform: record.platformSnapshot as AdvertisingPlatform,
    externalAccountId: record.externalAccountSnapshot,
    requestedAmount: money(record.requestedAmount),
    isdAmount: money(record.isdAmount),
    agencyFeeAmount: money(record.agencyFeeAmount),
    vatBaseAmount: money(record.vatBaseAmount),
    vatAmount: money(record.vatAmount),
    totalAmount: money(record.totalAmount),
    effectiveRechargeAmount: nullableMoney(record.effectiveRechargeAmount),
    status: record.status as TransactionDetailStatus,
    effectiveRechargeDate: iso(record.effectiveRechargeDate),
    completedAt: iso(record.completedAt),
  };
}

function toPayment(record: NonNullable<ClientDetailRecord["payment"]>): TransactionPaymentQueryView {
  return {
    id: record.id,
    status: record.status as TransactionPaymentStatus,
    expectedAmount: money(record.expectedAmount),
    confirmedAmount: nullableMoney(record.confirmedAmount),
    dueDate: iso(record.dueDate),
    confirmedAt: iso(record.confirmedAt),
    createdAt: record.createdAt.toISOString(),
    receipts: record.receipts.map(toReceipt),
  };
}

function toReceipt(record: NonNullable<ClientDetailRecord["payment"]>["receipts"][number]): PaymentReceiptClientView {
  return {
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    url: record.url,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  };
}

function toInvoice(record: NonNullable<ClientDetailRecord["invoice"]>): InvoiceQueryView {
  return {
    id: record.id,
    invoiceNumber: record.invoiceNumber,
    status: record.status as InvoiceStatus,
    issuedAt: record.issuedAt.toISOString(),
    pautaSubtotal: money(record.pautaSubtotal),
    isdAmount: money(record.isdAmount),
    agencyFeeAmount: money(record.agencyFeeAmount),
    vatBaseAmount: money(record.vatBaseAmount),
    vatAmount: money(record.vatAmount),
    totalAmount: money(record.totalAmount),
    documentUrl: record.documentUrl,
  };
}

function toVerification(record: AdminDetailRecord["verifications"][number], pautaAmount: Prisma.Decimal): VerificationAdminView {
  return {
    id: record.id,
    status: record.status as VerificationStatus,
    requestedPautaAmount: money(pautaAmount),
    expectedTransferAmount: money(record.expectedAmount),
    detectedTransferAmount: nullableMoney(record.detectedAmount),
    amountDifference: record.detectedAmount === null ? null : money(record.detectedAmount.minus(record.expectedAmount)),
    expectedAmount: money(record.expectedAmount),
    detectedAmount: nullableMoney(record.detectedAmount),
    amountMatches: record.amountMatches,
    issues: parseIssues(record.issues),
    requiresManualReview: record.requiresManualReview,
    decidedBy: record.decidedBy,
    decidedAt: iso(record.decidedAt),
    decisionNotes: record.decisionNotes,
    reviewReason: record.reviewReason,
    rejectionReason: record.rejectionReason,
    decisionAudit: record.decisionAudits[0] ? {
      previousStatus: record.decisionAudits[0].previousStatus,
      resultingStatus: record.decisionAudits[0].resultingStatus,
      decision: record.decisionAudits[0].decision as "APPROVE" | "REJECT" | "REVIEW",
      administratorUserId: record.decisionAudits[0].administratorUserId,
      notes: record.decisionAudits[0].notes,
      reviewReason: record.decisionAudits[0].reviewReason,
      rejectionReason: record.decisionAudits[0].rejectionReason,
      createdAt: record.decisionAudits[0].createdAt.toISOString(),
    } : null,
    receipt: { ...toReceipt(record.receipt), checksum: record.receipt.checksum },
    ocr: record.ocrResult ? {
      id: record.ocrResult.id,
      bank: record.ocrResult.bank,
      detectedAmount: nullableMoney(record.ocrResult.detectedAmount),
      detectedDate: iso(record.ocrResult.detectedDate),
      transactionCode: record.ocrResult.detectedTransactionCode,
      originator: record.ocrResult.originator,
      confidence: nullableNumber(record.ocrResult.confidence),
      rawText: record.ocrResult.rawText,
      failureReason: record.ocrResult.failureReason,
      createdAt: record.ocrResult.createdAt.toISOString(),
    } : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function parseIssues(value: string): readonly VerificationIssue[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((issue): issue is VerificationIssue => typeof issue === "string") : [];
  } catch {
    return [];
  }
}

function dateRange(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  return from || to ? { gte: from, lte: to } : undefined;
}
function verificationStatusFilter(scope: VerificationFilters["scope"]): Prisma.StringFilter | undefined {
  if (scope === "ALL") return undefined;
  if (scope === "APPROVED") return { equals: VerificationStatus.APPROVED };
  if (scope === "REJECTED") return { equals: VerificationStatus.REJECTED };
  return { in: [VerificationStatus.UNDER_REVIEW, VerificationStatus.AUTOMATICALLY_VERIFIED] };
}
function offset(pageNumber: number, pageSize: number): number { return (pageNumber - 1) * pageSize; }
function page<T>(items: readonly T[], pageNumber: number, pageSize: number, totalItems: number): PageResult<T> {
  return { items, page: pageNumber, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}
/* Búsqueda por código o nombre de cliente, compartida por el listado del admin y
   el del propio cliente para que una y otra encuentren lo mismo. */
/* Recorte de cartera: sin gestor no hay clave y la consulta no se toca; con
   gestor, la transaccion tiene que pertenecer a un cliente suyo. */
function managedClient(managerId: string | undefined): Prisma.RechargeTransactionWhereInput {
  return managerId ? { client: { is: { managerId } } } : {};
}

function transactionSearch(value: string | undefined): Prisma.RechargeTransactionWhereInput {
  if (!value) return {};
  return { OR: [{ code: { contains: value } }, { client: { is: { name: { contains: value } } } }] };
}
function money(value: Prisma.Decimal): number { return Number(value.toFixed(2)); }
/* Las tarifas se guardan como fraccion (0.05), no como porcentaje. */
function rate(value: Prisma.Decimal): number { return Number(value.toString()); }
function nullableMoney(value: Prisma.Decimal | null | undefined): number | null { return value == null ? null : money(value); }
function nullableNumber(value: Prisma.Decimal | null | undefined): number | null { return value == null ? null : Number(value.toString()); }
function iso(value: Date | null | undefined): string | null { return value?.toISOString() ?? null; }
