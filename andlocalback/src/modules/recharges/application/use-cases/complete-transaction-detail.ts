import { ApplicationError } from "../../../../common/errors/application.error";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import {
  CompletedTransactionDetailView,
  TransactionExecutionPersistencePort,
} from "../ports/transaction-execution.ports";

export type CompleteTransactionDetailCommand = Readonly<{
  transactionId: string;
  detailId: string;
  effectiveAmount: number;
  /* Queda escrito en el movimiento de saldo: es el unico sitio donde el dinero
     se vuelve credito y no guardaba autor. */
  executedBy: string;
  /* Acreditar un importe distinto al solicitado es de administrador. El gestor
     lleva la relacion comercial con ese mismo cliente, asi que teclear el
     numero que se le abona seria el mismo conflicto que confirmar su cobro,
     un paso mas adelante y sin un si/no de por medio. */
  mayDeviate?: boolean;
  effectiveRechargeDate: Date;
}>;

export class CompleteTransactionDetail {
  constructor(
    private readonly persistence: TransactionExecutionPersistencePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: CompleteTransactionDetailCommand): Promise<CompletedTransactionDetailView> {
    this.assertId(command.transactionId, "TRANSACTION_REQUIRED", "La transaccion es obligatoria");
    this.assertId(command.detailId, "TRANSACTION_DETAIL_REQUIRED", "El detalle es obligatorio");
    const amount = this.parseAmount(command.effectiveAmount);
    if (!(command.effectiveRechargeDate instanceof Date) || Number.isNaN(command.effectiveRechargeDate.getTime())) {
      throw new ApplicationError("INVALID_EFFECTIVE_RECHARGE_DATE", "La fecha efectiva de recarga no es valida");
    }

    const context = await this.persistence.loadExecutionContext(command.transactionId);
    if (!context) throw new ApplicationError("TRANSACTION_NOT_FOUND", "La transaccion no existe", 404);
    const detail = context.details.find((candidate) => candidate.id === command.detailId);
    if (!detail) throw new ApplicationError("TRANSACTION_DETAIL_NOT_FOUND", "El detalle no pertenece a la transaccion", 404);

    if (!amount.equals(detail.requestedAmount) && !command.mayDeviate) {
      throw new ApplicationError(
        "EFFECTIVE_AMOUNT_DEVIATION_NOT_ALLOWED",
        "Acreditar un importe distinto al solicitado requiere un administrador",
        403,
      );
    }

    if (detail.status === TransactionDetailStatus.COMPLETED) {
      if (detail.effectiveAmount?.equals(amount)) {
        return this.persistence.completeTransactionDetail({
          transactionId: context.id,
          detailId: detail.id,
          effectiveAmount: amount,
          effectiveRechargeDate: command.effectiveRechargeDate,
          completedAt: this.clock(),
          executedBy: command.executedBy,
        });
      }
      throw new ApplicationError(
        "TRANSACTION_DETAIL_ALREADY_COMPLETED",
        "El detalle ya fue completado con otros datos efectivos",
        409,
      );
    }
    if (context.status === TransactionRechargeStatus.COMPLETED) {
      throw new ApplicationError("TRANSACTION_ALREADY_COMPLETED", "La recarga ya fue completada", 409);
    }
    if (detail.pausedAt) throw new ApplicationError("DETAIL_PAUSED", "La recarga está en stop y requiere reanudación manual", 409);
    if (context.status !== TransactionRechargeStatus.PROCESSING) {
      throw new ApplicationError("TRANSACTION_NOT_PROCESSING", "La recarga debe estar en proceso", 409);
    }
    if (detail.status !== TransactionDetailStatus.PROCESSING) {
      throw new ApplicationError("TRANSACTION_DETAIL_NOT_PROCESSING", "El detalle debe estar en proceso", 409);
    }

    return this.persistence.completeTransactionDetail({
      transactionId: context.id,
      detailId: detail.id,
      effectiveAmount: amount,
      effectiveRechargeDate: command.effectiveRechargeDate,
      completedAt: this.clock(),
      executedBy: command.executedBy,
    });
  }

  private parseAmount(value: number): MonetaryAmount {
    try {
      const amount = MonetaryAmount.fromMajorUnits(value);
      if (amount.isZero) throw new Error("zero");
      return amount;
    } catch {
      throw new ApplicationError("INVALID_EFFECTIVE_AMOUNT", "El monto efectivo debe ser mayor que cero y tener maximo dos decimales");
    }
  }

  private assertId(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }
}
