import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApplicationError } from "../../../../common/errors/application.error";
import { PrismaService } from "../../../../database/prisma.service";
import { assertRechargePlatforms } from "./platform-lifecycle";
import {
  PostpaidRechargeContext,
  PostpaidTransactionPersistencePort,
  PostpaidTransactionRecord,
  PostpaidTransactionView,
} from "../../application/ports/postpaid-transaction.ports";
import { Pauta } from "../../domain/entities/pauta";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../../domain/recharge.types";
import {
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import {
  decimalToMonetaryAmount,
  isUniqueConstraintError,
  monetaryAmountToDecimal,
} from "./prisma-multi-recharge.repository";

const postpaidTransactionInclude = {
  details: { orderBy: { createdAt: "asc" as const } },
  payment: true,
} satisfies Prisma.RechargeTransactionInclude;

type PostpaidTransactionRecordFromPrisma = Prisma.RechargeTransactionGetPayload<{
  include: typeof postpaidTransactionInclude;
}>;

@Injectable()
export class PrismaPostpaidTransactionRepository implements PostpaidTransactionPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async loadPostpaidContext(accountId: string): Promise<PostpaidRechargeContext> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        clientId: true,
        status: true,
        type: true,
        creditDays: true,
        creditLimit: true,
        creditUsed: true,
      },
    });
    if (!account) return { client: null, account: null, pautas: [] };

    const [client, pautas] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: account.clientId },
        select: { id: true, status: true },
      }),
      this.prisma.pauta.findMany({
        where: { clientId: account.clientId },
        orderBy: { createdAt: "asc" },
        include: { balanceMovements: { select: { transactionDetailId: true } } },
      }),
    ]);

    return {
      client: client ? { id: client.id, status: client.status as ClientStatus } : null,
      account: {
        id: account.id,
        clientId: account.clientId,
        status: account.status as AccountStatus,
        type: account.type as AccountType,
        creditDays: account.creditDays,
        creditLimit: decimalToMonetaryAmount(account.creditLimit),
        creditUsed: decimalToMonetaryAmount(account.creditUsed),
      },
      pautas: pautas.map((record) => new Pauta({
        id: record.id,
        clientId: record.clientId,
        platform: record.platform as AdvertisingPlatform,
        externalAccountId: record.externalAccountId,
        status: record.status as PautaStatus,
        currentBalance: decimalToMonetaryAmount(record.currentBalance),
        activatedAt: record.activatedAt,
        createdAt: record.createdAt,
        completedRechargeDetailIds: record.balanceMovements.map((movement) => movement.transactionDetailId),
      })),
    };
  }

  async findPostpaidByIdempotencyKey(clientId: string, idempotencyKey: string) {
    const record = await this.prisma.rechargeTransaction.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
      include: postpaidTransactionInclude,
    });
    return record ? toPostpaidTransactionView(record) : null;
  }

  async savePostpaid(record: PostpaidTransactionRecord): Promise<PostpaidTransactionView> {
    const { transaction, payment } = record;
    const replay = await this.findPostpaidByIdempotencyKey(transaction.clientId, transaction.idempotencyKey);
    if (replay) return replay;
    // La reserva de crédito se decide en centavos enteros: comparar el límite
    // en punto flotante haría que el borde exacto dependiera del ruido binario.
    const totalCents = Number(transaction.totals.totalAmount.cents);
    try {
      const saved = await this.prisma.$transaction(async (database) => {
        // One conditional SQL write performs the availability check and the
        // reservation. It compares against the live database values, not the
        // context snapshot previously read by the application.
        const reserved = await database.$executeRaw`
          UPDATE Account
          SET creditUsed = (CAST(ROUND("creditUsed" * 100) AS INTEGER) + ${totalCents}) / 100.0
          WHERE id = ${transaction.accountId}
            AND status = 'ACTIVE'
            AND type = 'POSTPAGO'
            AND CAST(ROUND("creditUsed" * 100) AS INTEGER) + ${totalCents}
                <= CAST(ROUND("creditLimit" * 100) AS INTEGER)
        `;
        if (reserved !== 1) {
          // A same-key request may have committed while this call waited for
          // SQLite's write lock. It is an idempotent replay, not a credit
          // rejection, even when the winner consumed the remaining credit.
          const winner = await database.rechargeTransaction.findUnique({
            where: {
              clientId_idempotencyKey: {
                clientId: transaction.clientId,
                idempotencyKey: transaction.idempotencyKey,
              },
            },
            include: postpaidTransactionInclude,
          });
          if (winner) return winner;
          throw new ApplicationError(
            "CREDIT_INSUFFICIENT",
            "El credito disponible no cubre el total facturable de la recarga",
            409,
          );
        }

        await assertRechargePlatforms(database, transaction.clientId, transaction.accountId, transaction.details.map((detail) => detail.pautaSnapshot.pautaId));
        return database.rechargeTransaction.create({
          data: {
            id: transaction.id,
            code: transaction.code,
            idempotencyKey: transaction.idempotencyKey,
            clientId: transaction.clientId,
            accountId: transaction.accountId,
            accountTypeSnapshot: transaction.accountTypeSnapshot,
            creditDaysSnapshot: creditDaysBetween(payment.createdAt, payment.dueDate),
            rechargeStatus: transaction.status,
            isdRateSnapshot: new Prisma.Decimal("0.05"),
            agencyFeeRateSnapshot: new Prisma.Decimal("0.10"),
            vatRateSnapshot: new Prisma.Decimal("0.15"),
            pautaAmount: monetaryAmountToDecimal(transaction.totals.pautaAmount),
            isdAmount: monetaryAmountToDecimal(transaction.totals.isdAmount),
            agencyFeeAmount: monetaryAmountToDecimal(transaction.totals.agencyCommissionAmount),
            vatBaseAmount: monetaryAmountToDecimal(transaction.totals.vatBaseAmount),
            vatAmount: monetaryAmountToDecimal(transaction.totals.vatAmount),
            totalAmount: monetaryAmountToDecimal(transaction.totals.totalAmount),
            createdAt: transaction.createdAt,
            details: {
              create: transaction.details.map((detail) => ({
                id: detail.id,
                pautaId: detail.pautaSnapshot.pautaId,
                platformSnapshot: detail.pautaSnapshot.platform,
                externalAccountSnapshot: detail.pautaSnapshot.externalAccountId,
                requestedAmount: monetaryAmountToDecimal(detail.pricing.pautaAmount),
                isdAmount: monetaryAmountToDecimal(detail.pricing.isdAmount),
                agencyFeeAmount: monetaryAmountToDecimal(detail.pricing.agencyCommissionAmount),
                vatBaseAmount: monetaryAmountToDecimal(detail.pricing.vatBaseAmount),
                vatAmount: monetaryAmountToDecimal(detail.pricing.vatAmount),
                totalAmount: monetaryAmountToDecimal(detail.pricing.totalAmount),
                status: detail.status,
                createdAt: detail.createdAt,
              })),
            },
            payment: {
              create: {
                id: payment.id,
                status: payment.status,
                expectedAmount: monetaryAmountToDecimal(payment.expectedAmount),
                dueDate: payment.dueDate,
                createdAt: payment.createdAt,
              },
            },
          },
          include: postpaidTransactionInclude,
        });
      });
      return toPostpaidTransactionView(saved);
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;

      // If two identical requests race, the losing transaction (including its
      // credit reservation) rolls back and observes the single winner.
      const existing = await this.findPostpaidByIdempotencyKey(
        transaction.clientId,
        transaction.idempotencyKey,
      );
      if (existing) return existing;
      throw error;
    }
  }

  async markOverduePayments(asOf: Date): Promise<number> {
    const result = await this.prisma.payment.updateMany({
      where: { status: "IN_CREDIT", dueDate: { lt: asOf } },
      data: { status: "OVERDUE", version: { increment: 1 } },
    });
    return result.count;
  }
}

function creditDaysBetween(createdAt: Date, dueDate: Date | null): number {
  if (!dueDate) throw new Error("El pago postpago requiere fecha de vencimiento");
  return Math.round((dueDate.getTime() - createdAt.getTime()) / 86_400_000);
}

function decimalToSafeNumber(amount: Prisma.Decimal): number {
  return decimalToMonetaryAmount(amount).toSafeNumber();
}

function toPostpaidTransactionView(record: PostpaidTransactionRecordFromPrisma): PostpaidTransactionView {
  if (!record.payment) throw new Error(`La transaccion postpago ${record.id} no contiene pago`);
  return {
    id: record.id,
    code: record.code,
    idempotencyKey: record.idempotencyKey,
    clientId: record.clientId,
    accountId: record.accountId,
    accountTypeSnapshot: record.accountTypeSnapshot as AccountType,
    status: record.rechargeStatus as TransactionRechargeStatus,
    createdAt: record.createdAt.toISOString(),
    totals: {
      pautaAmount: decimalToSafeNumber(record.pautaAmount),
      isdAmount: decimalToSafeNumber(record.isdAmount),
      agencyCommissionAmount: decimalToSafeNumber(record.agencyFeeAmount),
      vatBaseAmount: decimalToSafeNumber(record.vatBaseAmount),
      vatAmount: decimalToSafeNumber(record.vatAmount),
      totalAmount: decimalToSafeNumber(record.totalAmount),
    },
    details: record.details.map((detail) => ({
      id: detail.id,
      pautaId: detail.pautaId,
      platform: detail.platformSnapshot as AdvertisingPlatform,
      externalAccountId: detail.externalAccountSnapshot,
      requestedAmount: decimalToSafeNumber(detail.requestedAmount),
      isdAmount: decimalToSafeNumber(detail.isdAmount),
      agencyCommissionAmount: decimalToSafeNumber(detail.agencyFeeAmount),
      vatBaseAmount: decimalToSafeNumber(detail.vatBaseAmount),
      vatAmount: decimalToSafeNumber(detail.vatAmount),
      totalAmount: decimalToSafeNumber(detail.totalAmount),
      status: detail.status as TransactionDetailStatus,
      createdAt: detail.createdAt.toISOString(),
    })),
    payment: {
      id: record.payment.id,
      transactionId: record.payment.transactionId,
      accountTypeSnapshot: record.accountTypeSnapshot as AccountType,
      status: record.payment.status as TransactionPaymentStatus,
      expectedAmount: decimalToSafeNumber(record.payment.expectedAmount),
      confirmedAmount: record.payment.confirmedAmount
        ? decimalToSafeNumber(record.payment.confirmedAmount)
        : null,
      dueDate: record.payment.dueDate?.toISOString() ?? null,
      createdAt: record.payment.createdAt.toISOString(),
    },
  };
}
