import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import { RechargeRepository, TransactionQueryRepository } from "../../application/ports/recharge.ports";
import { Recharge } from "../../domain/entities/recharge";
import {
  AccountType, AdvertisingPlatform, PaymentStatus, ReceiptStatus, RechargeStatus,
  TransactionHistoryEvent, VerificationIssue, VerificationStatus,
} from "../../domain/recharge.types";
import { Money } from "../../domain/value-objects/money";

const rechargeInclude = {
  receipts: { orderBy: { createdAt: "asc" as const } },
  verifications: { orderBy: { createdAt: "asc" as const } },
  obligation: true,
  history: { orderBy: { createdAt: "asc" as const } },
};

type RechargeRecord = Prisma.RechargeGetPayload<{ include: typeof rechargeInclude }>;

@Injectable()
export class PrismaRechargeRepository implements RechargeRepository, TransactionQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(recharge: Recharge) {
    const value = recharge.toPrimitives();
    const previous = await this.prisma.recharge.findUnique({ where: { id: value.id } });

    await this.prisma.$transaction(async (database) => {
      await database.recharge.upsert({
        where: { id: value.id },
        update: {
          paymentStatus: value.paymentStatus, status: value.status,
          receiptStatus: value.receiptStatus,
        },
        create: {
          id: value.id, accountId: value.accountId, accountType: value.accountType,
          campaignId: value.campaignId, platform: value.platform, amount: value.amount,
          paymentStatus: value.paymentStatus, status: value.status,
          receiptStatus: value.receiptStatus, createdAt: new Date(value.createdAt),
        },
      });

      for (const receipt of value.receipts) {
        await database.receipt.upsert({
          where: { id: receipt.id },
          update: { originalName: receipt.originalName, mimeType: receipt.mimeType, size: receipt.size, url: receipt.url, checksum: receipt.checksum },
          create: { id: receipt.id, rechargeId: value.id, originalName: receipt.originalName, mimeType: receipt.mimeType, size: receipt.size, url: receipt.url, checksum: receipt.checksum, createdAt: receipt.createdAt ? new Date(receipt.createdAt) : undefined },
        });
      }
      for (const verification of value.verifications) {
        await database.verification.upsert({
          where: { id: verification.id },
          update: {
            status: verification.status, detectedAmount: verification.detectedAmount,
            confidence: verification.confidence, amountMatches: verification.amountMatches,
            issues: JSON.stringify(verification.issues), requiresManualReview: verification.requiresManualReview,
            failureReason: verification.failureReason, decidedBy: verification.decidedBy,
            decidedAt: verification.decidedAt ? new Date(verification.decidedAt) : null,
            rejectionReason: verification.rejectionReason,
          },
          create: {
            id: verification.id, rechargeId: value.id, receiptId: verification.receiptId, status: verification.status,
            requestedAmount: verification.requestedAmount, detectedAmount: verification.detectedAmount,
            confidence: verification.confidence, amountMatches: verification.amountMatches,
            issues: JSON.stringify(verification.issues), requiresManualReview: verification.requiresManualReview,
            failureReason: verification.failureReason, decidedBy: verification.decidedBy,
            decidedAt: verification.decidedAt ? new Date(verification.decidedAt) : null,
            rejectionReason: verification.rejectionReason, createdAt: new Date(verification.createdAt),
          },
        });
      }
      if (value.obligation) {
        await database.paymentObligation.upsert({
          where: { rechargeId: value.id },
          update: { amount: value.obligation.amount, status: value.obligation.status, dueDate: new Date(value.obligation.dueDate) },
          create: { id: value.obligation.id, rechargeId: value.id, amount: value.obligation.amount, status: value.obligation.status, dueDate: new Date(value.obligation.dueDate), createdAt: new Date(value.obligation.createdAt) },
        });
      }

      const events = this.changedEvents(previous, value);
      if (events.length) await database.transactionEvent.createMany({ data: events.map((event) => ({ rechargeId: value.id, ...event })) });
    });
  }

  async findById(id: string) {
    const record = await this.prisma.recharge.findUnique({ where: { id }, include: rechargeInclude });
    return record ? this.toDomain(record) : null;
  }

  async listByAccount(accountId: string) {
    const records = await this.prisma.recharge.findMany({
      where: { accountId }, include: rechargeInclude, orderBy: { createdAt: "desc" },
    });
    return records.map((record) => ({
      ...this.toDomain(record).toPrimitives(),
      history: record.history.map((event): TransactionHistoryEvent => ({
        id: event.id,
        scope: event.scope as TransactionHistoryEvent["scope"],
        status: event.status,
        note: event.note,
        createdAt: event.createdAt.toISOString(),
      })),
    }));
  }

  async listAll() {
    const records = await this.prisma.recharge.findMany({
      include: { ...rechargeInclude, account: { include: { client: true } } },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => ({
      ...this.toDomain(record).toPrimitives(),
      client: { id: record.account.client.id, name: record.account.client.name, email: record.account.client.email },
      history: record.history.map((event): TransactionHistoryEvent => ({
        id: event.id, scope: event.scope as TransactionHistoryEvent["scope"], status: event.status,
        note: event.note, createdAt: event.createdAt.toISOString(),
      })),
    }));
  }

  private toDomain(record: RechargeRecord) {
    const recharge = new Recharge({
      id: record.id, accountId: record.accountId, accountType: record.accountType as AccountType,
      campaignId: record.campaignId, platform: record.platform as AdvertisingPlatform,
      amount: Money.fromAmount(record.amount),
      receipts: record.receipts.map((receipt) => ({
        id: receipt.id, originalName: receipt.originalName, mimeType: receipt.mimeType,
        size: receipt.size, url: receipt.url, checksum: receipt.checksum, createdAt: receipt.createdAt.toISOString(),
      })),
      createdAt: record.createdAt,
    });
    recharge.paymentStatus = record.paymentStatus as PaymentStatus;
    recharge.status = record.status as RechargeStatus;
    recharge.receiptStatus = record.receiptStatus as ReceiptStatus | null;
    recharge.verifications = record.verifications.map((verification) => ({
      id: verification.id, receiptId: verification.receiptId,
      status: verification.status as VerificationStatus,
      requestedAmount: verification.requestedAmount, detectedAmount: verification.detectedAmount,
      confidence: verification.confidence, amountMatches: verification.amountMatches,
      issues: JSON.parse(verification.issues) as VerificationIssue[],
      requiresManualReview: verification.requiresManualReview, failureReason: verification.failureReason,
      decidedBy: verification.decidedBy, decidedAt: verification.decidedAt?.toISOString() ?? null,
      rejectionReason: verification.rejectionReason, createdAt: verification.createdAt.toISOString(),
    }));
    recharge.obligation = record.obligation ? {
      id: record.obligation.id, amount: record.obligation.amount, status: PaymentStatus.ON_CREDIT,
      dueDate: record.obligation.dueDate.toISOString(), createdAt: record.obligation.createdAt.toISOString(),
    } : null;
    return recharge;
  }

  private changedEvents(previous: { paymentStatus: string; status: string; receiptStatus: string | null } | null, value: ReturnType<Recharge["toPrimitives"]>) {
    const events: Array<{ scope: string; status: string; note?: string }> = [];
    if (!previous || previous.status !== value.status) events.push({ scope: "RECARGA", status: value.status });
    if (!previous || previous.paymentStatus !== value.paymentStatus) events.push({ scope: "PAGO", status: value.paymentStatus });
    if (value.receiptStatus && (!previous || previous.receiptStatus !== value.receiptStatus)) events.push({ scope: "COMPROBANTE", status: value.receiptStatus });
    if (value.verification && (!previous || previous.paymentStatus !== value.paymentStatus)) {
      events.push({ scope: "VERIFICACION", status: value.verification.status, note: value.verification.rejectionReason ?? (value.verification.issues.join(", ") || "OCR procesado") });
    }
    return events;
  }
}
