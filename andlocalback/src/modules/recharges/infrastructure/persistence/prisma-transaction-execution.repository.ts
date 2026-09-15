import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApplicationError } from "../../../../common/errors/application.error";
import { PrismaService } from "../../../../database/prisma.service";
import {
  CompletedTransactionDetailView,
  InvoiceView,
  TransactionExecutionContext,
  TransactionExecutionPersistencePort,
  TransactionExecutionView,
} from "../../application/ports/transaction-execution.ports";
import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../../domain/model/domain-status";
import { AccountType } from "../../domain/recharge.types";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { decimalToMonetaryAmount, monetaryAmountToDecimal } from "./prisma-multi-recharge.repository";

const executionInclude = {
  client: { select: { status: true } },
  account: { select: { status: true } },
  payment: { select: { status: true } },
  invoice: true,
  details: {
    orderBy: { createdAt: "asc" as const },
    include: { pauta: { select: { status: true } } },
  },
} satisfies Prisma.RechargeTransactionInclude;

const executionViewInclude = {
  details: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.RechargeTransactionInclude;

type ExecutionRecord = Prisma.RechargeTransactionGetPayload<{ include: typeof executionInclude }>;
type ExecutionViewRecord = Prisma.RechargeTransactionGetPayload<{ include: typeof executionViewInclude }>;
type InvoiceRecord = Prisma.InvoiceGetPayload<Record<string, never>>;

@Injectable()
export class PrismaTransactionExecutionRepository
implements TransactionExecutionPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async loadExecutionContext(transactionId: string): Promise<TransactionExecutionContext | null> {
    const record = await this.prisma.rechargeTransaction.findUnique({
      where: { id: transactionId },
      include: executionInclude,
    });
    return record ? toExecutionContext(record) : null;
  }

  async startTransaction(
    transactionId: string,
    expectedVersion: number,
    _startedAt: Date,
  ): Promise<TransactionExecutionView> {
    try {
      return await this.prisma.$transaction(async (database) => {
        const current = await database.rechargeTransaction.findUnique({
          where: { id: transactionId },
          include: executionInclude,
        });
        if (!current) throw notFound("TRANSACTION_NOT_FOUND", "La transaccion no existe");
        assertStartPreconditions(current, expectedVersion);

        const updated = await database.rechargeTransaction.updateMany({
          where: {
            id: transactionId,
            version: expectedVersion,
            rechargeStatus: TransactionRechargeStatus.APPROVED,
          },
          data: {
            rechargeStatus: TransactionRechargeStatus.PROCESSING,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw conflict("TRANSACTION_CONCURRENTLY_MODIFIED", "La transaccion fue modificada por otro proceso");

        const details = await database.transactionDetail.updateMany({
          where: { transactionId, status: TransactionDetailStatus.APPROVED, pausedAt: null },
          data: { status: TransactionDetailStatus.PROCESSING, version: { increment: 1 } },
        });
        if (details.count !== current.details.filter((detail) => !detail.pausedAt).length) {
          throw conflict("TRANSACTION_DETAILS_CHANGED", "Los detalles de la transaccion cambiaron durante el inicio");
        }

        const result = await database.rechargeTransaction.findUniqueOrThrow({
          where: { id: transactionId },
          include: executionViewInclude,
        });
        return toExecutionView(result);
      });
    } catch (error: unknown) {
      throw normalizeWriteConflict(error);
    }
  }

  async completeTransactionDetail(command: Readonly<{
    transactionId: string;
    detailId: string;
    effectiveAmount: MonetaryAmount;
    effectiveRechargeDate: Date;
    completedAt: Date;
  }>): Promise<CompletedTransactionDetailView> {
    const replay = await this.completedDetailReplay(command);
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (database) => {
        const detail = await database.transactionDetail.findUnique({
          where: { id: command.detailId },
          include: {
            transaction: { select: { id: true, rechargeStatus: true } },
            pauta: { select: { id: true, currentBalance: true, version: true } },
            balanceMovement: true,
          },
        });
        if (!detail || detail.transactionId !== command.transactionId) {
          throw notFound("TRANSACTION_DETAIL_NOT_FOUND", "El detalle no pertenece a la transaccion");
        }
        if (detail.status === TransactionDetailStatus.COMPLETED) {
          return completedDetailView(detail, command.effectiveAmount);
        }
        if (detail.pausedAt) throw conflict("DETAIL_PAUSED", "La recarga está en stop y requiere reanudación manual");
        if (detail.transaction.rechargeStatus !== TransactionRechargeStatus.PROCESSING) {
          throw conflict("TRANSACTION_NOT_PROCESSING", "La transaccion debe estar en proceso");
        }
        if (detail.status !== TransactionDetailStatus.PROCESSING) {
          throw conflict("DETAIL_NOT_PROCESSING", "El detalle debe estar en proceso");
        }

        const effectiveAmount = monetaryAmountToDecimal(command.effectiveAmount);
        const detailUpdated = await database.transactionDetail.updateMany({
          where: {
            id: detail.id,
            transactionId: command.transactionId,
            version: detail.version,
            status: TransactionDetailStatus.PROCESSING,
            pausedAt: null,
          },
          data: {
            status: TransactionDetailStatus.COMPLETED,
            effectiveRechargeAmount: effectiveAmount,
            effectiveRechargeDate: command.effectiveRechargeDate,
            completedAt: command.completedAt,
            version: { increment: 1 },
          },
        });
        if (detailUpdated.count !== 1) throw conflict("DETAIL_CONCURRENTLY_MODIFIED", "El detalle fue completado por otro proceso");

        // La pauta pudo ser suspendida despues de iniciar. En este punto la
        // recarga externa ya fue efectiva y debe contabilizarse sin perderla.
        const balanceBefore = decimalToMonetaryAmount(detail.pauta.currentBalance);
        const balanceAfter = balanceBefore.add(command.effectiveAmount);
        const pautaUpdated = await database.pauta.updateMany({
          where: { id: detail.pautaId, version: detail.pauta.version },
          data: {
            currentBalance: monetaryAmountToDecimal(balanceAfter),
            version: { increment: 1 },
          },
        });
        if (pautaUpdated.count !== 1) throw conflict("PAUTA_BALANCE_CONCURRENTLY_MODIFIED", "El saldo de la pauta fue modificado por otro proceso");

        await database.pautaBalanceMovement.create({
          data: {
            pautaId: detail.pautaId,
            transactionDetailId: detail.id,
            type: "RECHARGE",
            amount: effectiveAmount,
            balanceBefore: monetaryAmountToDecimal(balanceBefore),
            balanceAfter: monetaryAmountToDecimal(balanceAfter),
            createdAt: command.completedAt,
          },
        });

        return {
          transactionId: command.transactionId,
          detailId: detail.id,
          pautaId: detail.pautaId,
          status: TransactionDetailStatus.COMPLETED,
          effectiveAmount: command.effectiveAmount.toSafeNumber(),
          effectiveRechargeDate: command.effectiveRechargeDate.toISOString(),
          pautaBalance: balanceAfter.toSafeNumber(),
        };
      });
    } catch (error: unknown) {
      const winner = await this.completedDetailReplay(command);
      if (winner) return winner;
      throw normalizeWriteConflict(error);
    }
  }

  async finalizeTransactionAndIssueInvoice(command: Readonly<{
    transactionId: string;
    expectedVersion: number;
    invoiceId: string;
    completedAt: Date;
  }>): Promise<Readonly<{ transaction: TransactionExecutionView; invoice: InvoiceView }>> {
    const replay = await this.finalizationReplay(command.transactionId);
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (database) => {
        const current = await database.rechargeTransaction.findUnique({
          where: { id: command.transactionId },
          include: { ...executionViewInclude, invoice: true },
        });
        if (!current) throw notFound("TRANSACTION_NOT_FOUND", "La transaccion no existe");
        if (current.rechargeStatus === TransactionRechargeStatus.COMPLETED && current.invoice) {
          return { transaction: toExecutionView(current), invoice: toInvoiceView(current.invoice) };
        }
        if (current.version !== command.expectedVersion) {
          throw conflict("TRANSACTION_CONCURRENTLY_MODIFIED", "La transaccion fue modificada por otro proceso");
        }
        if (current.rechargeStatus !== TransactionRechargeStatus.PROCESSING) {
          throw conflict("TRANSACTION_NOT_PROCESSING", "La transaccion debe estar en proceso");
        }
        if (current.details.length === 0 || current.details.some((detail) => detail.status !== TransactionDetailStatus.COMPLETED)) {
          throw conflict("INCOMPLETE_TRANSACTION_DETAILS", "Todos los detalles deben estar completados");
        }

        const completed = await database.rechargeTransaction.updateMany({
          where: {
            id: current.id,
            version: command.expectedVersion,
            rechargeStatus: TransactionRechargeStatus.PROCESSING,
          },
          data: {
            rechargeStatus: TransactionRechargeStatus.COMPLETED,
            completedAt: command.completedAt,
            version: { increment: 1 },
          },
        });
        if (completed.count !== 1) throw conflict("TRANSACTION_CONCURRENTLY_MODIFIED", "La transaccion fue completada por otro proceso");

        const invoice = await database.invoice.create({
          data: {
            id: command.invoiceId,
            transactionId: current.id,
            invoiceNumber: invoiceNumber(current.code),
            status: InvoiceStatus.ISSUED,
            issuedAt: command.completedAt,
            pautaSubtotal: current.pautaAmount,
            isdAmount: current.isdAmount,
            agencyFeeAmount: current.agencyFeeAmount,
            vatBaseAmount: current.vatBaseAmount,
            vatAmount: current.vatAmount,
            totalAmount: current.totalAmount,
          },
        });
        const transaction = await database.rechargeTransaction.findUniqueOrThrow({
          where: { id: current.id },
          include: executionViewInclude,
        });
        return { transaction: toExecutionView(transaction), invoice: toInvoiceView(invoice) };
      });
    } catch (error: unknown) {
      const winner = await this.finalizationReplay(command.transactionId);
      if (winner) return winner;
      throw normalizeWriteConflict(error);
    }
  }

  async resumeDetail(transactionId: string, detailId: string, administratorId: string, expectedVersion?: number) {
    return this.prisma.$transaction(async (database) => {
      const detail = await database.transactionDetail.findFirst({
        where: { id: detailId, transactionId },
        include: { pauta: true, transaction: { include: { payment: true, client: true, account: true } } },
      });
      if (!detail) throw notFound("TRANSACTION_DETAIL_NOT_FOUND", "El detalle no pertenece a la transacción");
      if (expectedVersion !== undefined && detail.version !== expectedVersion) throw conflict("DETAIL_CONCURRENTLY_MODIFIED", "La recarga cambió. Actualiza antes de reanudar");
      const transaction = detail.transaction;
      if (!detail.pausedAt || !["REQUESTED", "APPROVED", "PROCESSING"].includes(detail.status)) throw conflict("DETAIL_NOT_PAUSED", "El detalle no tiene una pausa pendiente");
      if (detail.pauta.status !== "ACTIVE") throw conflict("PAUTA_NOT_ACTIVE", "Reactiva la plataforma antes de reanudar la recarga");
      if (transaction.client.status !== "ACTIVE" || transaction.account.status !== "ACTIVE") throw conflict("CLIENT_INACTIVE", "El cliente y su cuenta deben estar activos");
      if (!["APPROVED", "PROCESSING"].includes(transaction.rechargeStatus)) throw conflict("TRANSACTION_NOT_APPROVED", "Aprueba la recarga antes de reanudarla");
      const allowedPayments = transaction.accountTypeSnapshot === "PREPAGO" ? ["PAID"] : ["PAID", "IN_CREDIT", "UNDER_REVIEW", "OVERDUE"];
      if (!transaction.payment || !allowedPayments.includes(transaction.payment.status)) throw conflict("PAYMENT_NOT_CONFIRMED", "El pago no permite reanudar esta recarga");
      const result = await database.transactionDetail.updateMany({
        where: { id: detail.id, version: detail.version, pausedAt: detail.pausedAt },
        data: { pausedAt: null, status: transaction.rechargeStatus === "PROCESSING" ? "PROCESSING" : "APPROVED", version: { increment: 1 } },
      });
      if (result.count !== 1) throw conflict("DETAIL_CONCURRENTLY_MODIFIED", "El detalle cambió. Actualiza antes de reanudar");
      await database.platformLifecycleAudit.create({ data: { clientId: transaction.clientId, pautaId: detail.pautaId, detailId, action: "RESUME", actorId: administratorId } });
      return { clientId: transaction.clientId, transactionId, detailId, pausedAt: null };
    });
  }

  private async completedDetailReplay(command: Readonly<{
    transactionId: string;
    detailId: string;
    effectiveAmount: MonetaryAmount;
  }>): Promise<CompletedTransactionDetailView | null> {
    const detail = await this.prisma.transactionDetail.findUnique({
      where: { id: command.detailId },
      include: { pauta: { select: { currentBalance: true } }, balanceMovement: true },
    });
    if (!detail || detail.transactionId !== command.transactionId || detail.status !== TransactionDetailStatus.COMPLETED || !detail.balanceMovement) return null;
    return completedDetailView(detail, command.effectiveAmount);
  }

  private async finalizationReplay(transactionId: string) {
    const transaction = await this.prisma.rechargeTransaction.findUnique({
      where: { id: transactionId }, include: { ...executionViewInclude, invoice: true },
    });
    if (!transaction || transaction.rechargeStatus !== TransactionRechargeStatus.COMPLETED || !transaction.invoice) return null;
    return { transaction: toExecutionView(transaction), invoice: toInvoiceView(transaction.invoice) };
  }
}

function assertStartPreconditions(record: ExecutionRecord, expectedVersion: number): void {
  if (record.rechargeStatus !== TransactionRechargeStatus.APPROVED) throw conflict("TRANSACTION_NOT_APPROVED", "La transaccion debe estar aprobada");
  if (record.version !== expectedVersion) throw conflict("TRANSACTION_CONCURRENTLY_MODIFIED", "La transaccion fue modificada por otro proceso");
  if (record.client.status !== "ACTIVE") throw conflict("CLIENT_INACTIVE", "El cliente no esta activo");
  if (record.account.status !== "ACTIVE") throw conflict("ACCOUNT_INACTIVE", "La cuenta no esta activa");
  if (!record.payment) throw conflict("PAYMENT_NOT_FOUND", "La transaccion no tiene pago");
  if (record.accountTypeSnapshot === AccountType.PREPAID && record.payment.status !== TransactionPaymentStatus.PAID) {
    throw conflict("PAYMENT_NOT_CONFIRMED", "La recarga prepago requiere pago confirmado");
  }
  if (record.accountTypeSnapshot === AccountType.POSTPAID && ![
    TransactionPaymentStatus.IN_CREDIT,
    TransactionPaymentStatus.UNDER_REVIEW,
    TransactionPaymentStatus.OVERDUE,
    TransactionPaymentStatus.PAID,
  ].includes(record.payment.status as TransactionPaymentStatus)) {
    throw conflict("CREDIT_NOT_AUTHORIZED", "La obligacion postpago no esta autorizada");
  }
  if (record.details.length === 0 || record.details.some((detail) => detail.status !== TransactionDetailStatus.APPROVED)) {
    throw conflict("TRANSACTION_DETAILS_NOT_APPROVED", "Todos los detalles deben estar aprobados");
  }
  const executable = record.details.filter((detail) => !detail.pausedAt);
  if (!executable.length) throw conflict("RECHARGES_PAUSED", "Las recargas están en stop. Reanuda un detalle antes de iniciar");
  if (executable.some((detail) => detail.pauta.status !== PautaStatus.ACTIVE)) {
    throw conflict("PAUTA_NOT_ACTIVE", "Todas las pautas deben estar activas al iniciar");
  }
}

function toExecutionContext(record: ExecutionRecord): TransactionExecutionContext {
  if (!record.payment) throw new Error(`La transaccion ${record.id} no contiene pago`);
  return {
    id: record.id,
    code: record.code,
    accountTypeSnapshot: record.accountTypeSnapshot as AccountType,
    status: record.rechargeStatus as TransactionRechargeStatus,
    version: record.version,
    paymentStatus: record.payment.status as TransactionPaymentStatus,
    details: record.details.map((detail) => ({
      id: detail.id,
      pautaId: detail.pautaId,
      pautaStatus: detail.pauta.status as PautaStatus,
      pausedAt: detail.pausedAt?.toISOString() ?? null,
      status: detail.status as TransactionDetailStatus,
      effectiveAmount: detail.effectiveRechargeAmount ? decimalToMonetaryAmount(detail.effectiveRechargeAmount) : null,
      effectiveRechargeDate: detail.effectiveRechargeDate,
    })),
    totals: transactionTotals(record),
    completedAt: record.completedAt,
    invoice: record.invoice ? toInvoiceView(record.invoice) : null,
  };
}

function toExecutionView(record: ExecutionViewRecord): TransactionExecutionView {
  return {
    transactionId: record.id,
    code: record.code,
    status: record.rechargeStatus as TransactionRechargeStatus,
    completedAt: record.completedAt?.toISOString() ?? null,
    details: record.details.map((detail) => ({
      id: detail.id,
      pautaId: detail.pautaId,
      status: detail.status as TransactionDetailStatus,
      effectiveAmount: detail.effectiveRechargeAmount ? decimalToMonetaryAmount(detail.effectiveRechargeAmount).toSafeNumber() : null,
      effectiveRechargeDate: detail.effectiveRechargeDate?.toISOString() ?? null,
    })),
  };
}

function transactionTotals(record: Pick<ExecutionRecord, "pautaAmount" | "isdAmount" | "agencyFeeAmount" | "vatBaseAmount" | "vatAmount" | "totalAmount">) {
  return Object.freeze({
    pautaAmount: decimalToMonetaryAmount(record.pautaAmount),
    isdAmount: decimalToMonetaryAmount(record.isdAmount),
    agencyCommissionAmount: decimalToMonetaryAmount(record.agencyFeeAmount),
    vatBaseAmount: decimalToMonetaryAmount(record.vatBaseAmount),
    vatAmount: decimalToMonetaryAmount(record.vatAmount),
    totalAmount: decimalToMonetaryAmount(record.totalAmount),
  });
}

function completedDetailView(
  detail: { transactionId: string; id: string; pautaId: string; effectiveRechargeAmount: Prisma.Decimal | null; effectiveRechargeDate: Date | null; balanceMovement: { amount: Prisma.Decimal; balanceAfter: Prisma.Decimal } | null },
  expectedAmount: MonetaryAmount,
): CompletedTransactionDetailView {
  if (!detail.effectiveRechargeAmount || !detail.effectiveRechargeDate || !detail.balanceMovement) {
    throw conflict("DETAIL_COMPLETION_INCONSISTENT", "El detalle completado no tiene movimiento de saldo");
  }
  const actual = decimalToMonetaryAmount(detail.effectiveRechargeAmount);
  if (!actual.equals(expectedAmount)) throw conflict("DETAIL_ALREADY_COMPLETED", "El detalle ya fue completado con otro monto");
  return {
    transactionId: detail.transactionId,
    detailId: detail.id,
    pautaId: detail.pautaId,
    status: TransactionDetailStatus.COMPLETED,
    effectiveAmount: actual.toSafeNumber(),
    effectiveRechargeDate: detail.effectiveRechargeDate.toISOString(),
    pautaBalance: decimalToMonetaryAmount(detail.balanceMovement.balanceAfter).toSafeNumber(),
  };
}

function invoiceNumber(code: string): string {
  return `FAC-${code}`;
}

function toInvoiceView(invoice: InvoiceRecord): InvoiceView {
  return {
    id: invoice.id,
    transactionId: invoice.transactionId,
    number: invoice.invoiceNumber,
    status: invoice.status as InvoiceStatus,
    issuedAt: invoice.issuedAt.toISOString(),
    pautaAmount: decimalToMonetaryAmount(invoice.pautaSubtotal).toSafeNumber(),
    isdAmount: decimalToMonetaryAmount(invoice.isdAmount).toSafeNumber(),
    agencyCommissionAmount: decimalToMonetaryAmount(invoice.agencyFeeAmount).toSafeNumber(),
    vatBaseAmount: decimalToMonetaryAmount(invoice.vatBaseAmount).toSafeNumber(),
    vatAmount: decimalToMonetaryAmount(invoice.vatAmount).toSafeNumber(),
    totalAmount: decimalToMonetaryAmount(invoice.totalAmount).toSafeNumber(),
  };
}

function notFound(code: string, message: string): ApplicationError {
  return new ApplicationError(code, message, 404);
}

function conflict(code: string, message: string): ApplicationError {
  return new ApplicationError(code, message, 409);
}

function normalizeWriteConflict(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2028")) {
    return conflict("CONCURRENT_OPERATION", "La operacion fue ejecutada concurrentemente");
  }
  return error;
}
