import { ApplicationError } from "../../../../common/errors/application.error";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { IdGenerator } from "../ports/recharge.ports";
import {
  CompletedTransactionView,
  TransactionExecutionContext,
  TransactionExecutionPersistencePort,
} from "../ports/transaction-execution.ports";

export type CompleteTransactionCommand = Readonly<{ transactionId: string }>;

export class CompleteTransaction {
  constructor(
    private readonly persistence: TransactionExecutionPersistencePort,
    private readonly ids: IdGenerator,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: CompleteTransactionCommand): Promise<CompletedTransactionView> {
    if (typeof command.transactionId !== "string" || command.transactionId.trim().length === 0) {
      throw new ApplicationError("TRANSACTION_REQUIRED", "La transaccion es obligatoria");
    }
    const context = await this.persistence.loadExecutionContext(command.transactionId);
    if (!context) throw new ApplicationError("TRANSACTION_NOT_FOUND", "La transaccion no existe", 404);

    if (context.status === TransactionRechargeStatus.COMPLETED) {
      if (!context.invoice) throw new ApplicationError("COMPLETED_TRANSACTION_WITHOUT_INVOICE", "La transaccion completada no tiene factura", 409);
      return { transaction: this.presentCompletedContext(context), invoice: context.invoice };
    }
    if (context.status !== TransactionRechargeStatus.PROCESSING) {
      throw new ApplicationError("TRANSACTION_NOT_PROCESSING", "La recarga debe estar en proceso", 409);
    }
    if (context.details.some((detail) => detail.status !== TransactionDetailStatus.COMPLETED)) {
      throw new ApplicationError("INCOMPLETE_TRANSACTION_DETAILS", "Todos los detalles deben estar completados", 409);
    }

    const at = this.clock();
    const invoiceId = this.ids.generate();
    return this.persistence.finalizeTransactionAndIssueInvoice({
      transactionId: context.id,
      expectedVersion: context.version,
      invoiceId,
      completedAt: at,
    });
  }

  private presentCompletedContext(context: TransactionExecutionContext): CompletedTransactionView["transaction"] {
    const money = (value: MonetaryAmount | null) => value ? value.toSafeNumber() : null;
    return {
      transactionId: context.id,
      code: context.code,
      status: TransactionRechargeStatus.COMPLETED,
      completedAt: context.completedAt?.toISOString() ?? null,
      details: context.details.map((detail) => ({
        id: detail.id,
        pautaId: detail.pautaId,
        status: detail.status,
        effectiveAmount: money(detail.effectiveAmount),
        effectiveRechargeDate: detail.effectiveRechargeDate?.toISOString() ?? null,
      })),
    };
  }
}
