import { ApplicationError } from "../../../../common/errors/application.error";
import { PautaStatus, TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { AccountType } from "../../domain/recharge.types";
import {
  TransactionExecutionPersistencePort,
  TransactionExecutionView,
} from "../ports/transaction-execution.ports";

export type StartTransactionRechargeCommand = Readonly<{ transactionId: string }>;

export class StartTransactionRecharge {
  constructor(
    private readonly persistence: TransactionExecutionPersistencePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: StartTransactionRechargeCommand): Promise<TransactionExecutionView> {
    this.assertId(command.transactionId);
    const context = await this.persistence.loadExecutionContext(command.transactionId);
    if (!context) throw new ApplicationError("TRANSACTION_NOT_FOUND", "La transaccion no existe", 404);
    if (context.status === TransactionRechargeStatus.COMPLETED) {
      throw new ApplicationError("TRANSACTION_ALREADY_COMPLETED", "La recarga completada no puede ejecutarse nuevamente", 409);
    }
    if (context.status !== TransactionRechargeStatus.APPROVED) {
      throw new ApplicationError("TRANSACTION_NOT_APPROVED", "La recarga debe estar aprobada para iniciar", 409);
    }

    if (context.accountTypeSnapshot === AccountType.PREPAID) {
      if (context.paymentStatus !== TransactionPaymentStatus.PAID) {
        throw new ApplicationError("PREPAID_PAYMENT_NOT_CONFIRMED", "La recarga prepago requiere un pago confirmado", 409);
      }
    } else {
      const allowed = new Set([
        TransactionPaymentStatus.IN_CREDIT,
        TransactionPaymentStatus.OVERDUE,
        TransactionPaymentStatus.UNDER_REVIEW,
        TransactionPaymentStatus.PAID,
      ]);
      if (!allowed.has(context.paymentStatus)) {
        throw new ApplicationError("POSTPAID_OBLIGATION_NOT_VALID", "La obligacion postpago no permite iniciar la recarga", 409);
      }
    }

    if (context.details.filter((detail) => !detail.pausedAt).some((detail) => detail.pautaStatus !== PautaStatus.ACTIVE)) {
      throw new ApplicationError("PAUTA_NOT_ACTIVE", "Todas las pautas deben estar activas al iniciar la recarga", 409);
    }
    if (!context.details.some((detail) => !detail.pausedAt)) throw new ApplicationError("RECHARGES_PAUSED", "Las recargas están en stop. Reanuda un detalle antes de iniciar", 409);
    return this.persistence.startTransaction(context.id, context.version, this.clock());
  }

  private assertId(value: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ApplicationError("TRANSACTION_REQUIRED", "La transaccion es obligatoria");
    }
  }
}
