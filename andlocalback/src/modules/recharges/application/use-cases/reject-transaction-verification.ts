import { ApplicationError } from "../../../../common/errors/application.error";
import { TransactionPaymentStatus } from "../../domain/model/domain-status";
import { VerificationStatus } from "../../domain/recharge.types";
import {
  TransactionVerificationPersistencePort,
  VerificationRealtimePublisher,
  TransactionVerificationView,
} from "../ports/transaction-verification.ports";

export type RejectTransactionVerificationCommand = Readonly<{
  verificationId: string;
  administratorId: string;
  reason: string;
}>;

export class RejectTransactionVerification {
  constructor(
    private readonly persistence: TransactionVerificationPersistencePort,
    private readonly now: () => Date = () => new Date(),
    private readonly realtime: VerificationRealtimePublisher = { publishVerification: () => undefined },
  ) {}

  async execute(command: RejectTransactionVerificationCommand): Promise<TransactionVerificationView> {
    this.assertRequired(command.verificationId, "VERIFICATION_REQUIRED", "La verificacion es obligatoria");
    this.assertRequired(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    this.assertRequired(command.reason, "REJECTION_REASON_REQUIRED", "El motivo de rechazo es obligatorio");
    const context = await this.persistence.loadVerificationContext(command.verificationId);
    if (!context) throw new ApplicationError("VERIFICATION_NOT_FOUND", "La verificacion no existe", 404);
    if (context.verification.status !== VerificationStatus.UNDER_REVIEW &&
        context.verification.status !== VerificationStatus.AUTOMATICALLY_VERIFIED) {
      throw new ApplicationError("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta", 409);
    }
    if (context.payment.status !== "UNDER_REVIEW") {
      throw new ApplicationError("PAYMENT_NOT_UNDER_REVIEW", "El pago debe estar en revision", 409);
    }

    const decidedAt = this.now();
    const result = await this.persistence.rejectAtomically({
      context,
      administratorId: command.administratorId.trim(),
      reason: command.reason.trim(),
      decidedAt,
    });
    const paymentStatus = context.transaction.accountTypeSnapshot === "POSTPAGO"
      ? (context.payment.dueDate && context.payment.dueDate.getTime() < decidedAt.getTime()
        ? TransactionPaymentStatus.OVERDUE
        : TransactionPaymentStatus.IN_CREDIT)
      : TransactionPaymentStatus.REJECTED;
    this.realtime.publishVerification({
      eventId: `${result.id}:${result.version}`,
      verificationId: result.id,
      transactionId: context.transaction.id,
      accountId: context.transaction.accountId,
      status: result.status,
      paymentStatus,
      rechargeStatus: context.transaction.status,
      reason: command.reason.trim(),
      version: result.version,
      occurredAt: decidedAt.toISOString(),
    });
    return result;
  }

  private assertRequired(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }
}
