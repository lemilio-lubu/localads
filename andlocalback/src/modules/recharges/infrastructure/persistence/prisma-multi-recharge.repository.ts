import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import { assertRechargePlatforms } from "./platform-lifecycle";
import {
  MultiRechargePersistencePort,
  PrepaidTransactionRecord,
  PrepaidTransactionView,
} from "../../application/ports/multi-recharge.ports";
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

const prepaidTransactionInclude = {
  details: { orderBy: { createdAt: "asc" as const } },
  payment: { include: { receipts: { orderBy: { createdAt: "asc" as const } } } },
} satisfies Prisma.RechargeTransactionInclude;

type PrepaidTransactionRecordFromPrisma = Prisma.RechargeTransactionGetPayload<{
  include: typeof prepaidTransactionInclude;
}>;

@Injectable()
export class PrismaMultiRechargeRepository implements MultiRechargePersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, clientId: true, status: true, type: true },
    });
    if (!account) return { client: null, account: null, pautas: [] };

    const [client, pautas] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: account.clientId }, select: { id: true, status: true } }),
      this.prisma.pauta.findMany({
        where: { clientId: account.clientId },
        orderBy: { createdAt: "asc" },
        include: { balanceMovements: { select: { transactionDetailId: true } } },
      }),
    ]);

    return {
      client: client ? { id: client.id, status: client.status as ClientStatus } : null,
      account: account ? {
        id: account.id,
        clientId: account.clientId,
        status: account.status as AccountStatus,
        type: account.type as AccountType,
      } : null,
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

  async findByIdempotencyKey(clientId: string, idempotencyKey: string) {
    const record = await this.prisma.rechargeTransaction.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
      include: prepaidTransactionInclude,
    });
    return record ? toPrepaidTransactionView(record) : null;
  }

  async savePrepaid(record: PrepaidTransactionRecord): Promise<PrepaidTransactionView> {
    const { transaction, payment, receipt } = record;
    try {
      const saved = await this.prisma.$transaction(async (database) => {
        const replay = await database.rechargeTransaction.findUnique({ where: { clientId_idempotencyKey: { clientId: transaction.clientId, idempotencyKey: transaction.idempotencyKey } }, include: prepaidTransactionInclude });
        if (replay) return replay;
        await assertRechargePlatforms(database, transaction.clientId, transaction.accountId, transaction.details.map((detail) => detail.pautaSnapshot.pautaId));
        return database.rechargeTransaction.create({
        data: {
          id: transaction.id,
          code: transaction.code,
          idempotencyKey: transaction.idempotencyKey,
          clientId: transaction.clientId,
          accountId: transaction.accountId,
          accountTypeSnapshot: transaction.accountTypeSnapshot,
          creditDaysSnapshot: null,
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
              confirmedAmount: payment.confirmedAmount
                ? monetaryAmountToDecimal(payment.confirmedAmount)
                : null,
              dueDate: payment.dueDate,
              confirmedAt: payment.confirmedAt,
              createdAt: payment.createdAt,
              receipts: {
                create: {
                  id: receipt.id,
                  originalName: receipt.originalName,
                  mimeType: receipt.mimeType,
                  size: receipt.size,
                  url: receipt.url,
                  checksum: receipt.checksum,
                  status: "LOADED",
                  createdAt: receipt.createdAt ? new Date(receipt.createdAt) : undefined,
                },
              },
            },
          },
        },
        include: prepaidTransactionInclude,
        });
      });
      return toPrepaidTransactionView(saved);
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;

      // A concurrent request may have passed the application pre-check. The
      // database uniqueness constraint decides the winner; retries observe it.
      const existing = await this.findByIdempotencyKey(transaction.clientId, transaction.idempotencyKey);
      if (existing) return existing;
      throw error;
    }
  }
}

export function monetaryAmountToDecimal(amount: MonetaryAmount): Prisma.Decimal {
  return new Prisma.Decimal(amount.toMajorUnits());
}

export function decimalToMonetaryAmount(amount: Prisma.Decimal): MonetaryAmount {
  return MonetaryAmount.fromMajorUnits(amount.toFixed(2));
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function decimalToSafeNumber(amount: Prisma.Decimal): number {
  return decimalToMonetaryAmount(amount).toSafeNumber();
}

function toPrepaidTransactionView(record: PrepaidTransactionRecordFromPrisma): PrepaidTransactionView {
  if (!record.payment || record.payment.receipts.length !== 1) {
    throw new Error(`La transaccion prepago ${record.id} no contiene exactamente un pago y un comprobante`);
  }
  const receipt = record.payment.receipts[0];
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
    receipt: {
      id: receipt.id,
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      size: receipt.size,
      url: receipt.url,
      checksum: receipt.checksum,
      createdAt: receipt.createdAt?.toISOString() ?? null,
    },
  };
}
