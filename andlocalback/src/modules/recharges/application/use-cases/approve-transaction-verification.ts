import { ApplicationError } from "../../../../common/errors/application.error";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { AccountType, VerificationStatus } from "../../domain/recharge.types";
import {
  TransactionVerificationPersistencePort,
  VerificationRealtimePublisher,
  TransactionVerificationView,
} from "../ports/transaction-verification.ports";

export type ApproveTransactionVerificationCommand = Readonly<{
  verificationId: string;
  administratorId: string;
  notes?: string;
}>;

export class ApproveTransactionVerification {
  constructor(
    private readonly persistence: TransactionVerificationPersistencePort,
    private readonly now: () => Date = () => new Date(),
    private readonly realtime: VerificationRealtimePublisher = { publishVerification: () => undefined },
  ) {}

  async execute(command: ApproveTransactionVerificationCommand): Promise<TransactionVerificationView> {
    this.assertRequired(command.verificationId, "VERIFICATION_REQUIRED", "La verificacion es obligatoria");
    this.assertRequired(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    const context = await this.persistence.loadVerificationContext(command.verificationId);
    if (!context) throw new ApplicationError("VERIFICATION_NOT_FOUND", "La verificacion no existe", 404);

    if (context.verification.status !== VerificationStatus.UNDER_REVIEW &&
        context.verification.status !== VerificationStatus.AUTOMATICALLY_VERIFIED) {
      throw new ApplicationError("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta", 409);
    }
    if (context.payment.status !== "UNDER_REVIEW") {
      throw new ApplicationError("PAYMENT_NOT_UNDER_REVIEW", "El pago debe estar en revision", 409);
    }
    if (context.transaction.accountTypeSnapshot === AccountType.PREPAID && context.transaction.status !== "UNDER_REVIEW") {
      throw new ApplicationError("TRANSACTION_NOT_UNDER_REVIEW", "La recarga debe estar en revision", 409);
    }
    const duplicates = await this.persistence.findConfirmedDuplicates({
      excludePaymentId: context.payment.id,
      checksum: context.receipt.checksum,
      transactionCode: context.ocr?.transactionCode ?? null,
    });
    if (duplicates.checksumUsed) {
      throw new ApplicationError("RECEIPT_ALREADY_CONFIRMED", "El comprobante ya confirmo otro pago", 409);
    }
    if (duplicates.transactionCodeUsed) {
      throw new ApplicationError("BANK_REFERENCE_ALREADY_CONFIRMED", "El codigo bancario ya confirmo otro pago", 409);
    }

    const decidedAt = this.now();
    const result = await this.persistence.approveAtomically({
      context,
      administratorId: command.administratorId.trim(),
      notes: command.notes?.trim() || null,
      decidedAt,
    });
    this.realtime.publishVerification({
      eventId: `${result.id}:${result.version}`,
      verificationId: result.id,
      transactionId: context.transaction.id,
      accountId: context.transaction.accountId,
      status: result.status,
      paymentStatus: TransactionPaymentStatus.PAID,
      rechargeStatus: context.transaction.accountTypeSnapshot === AccountType.PREPAID
        ? TransactionRechargeStatus.APPROVED
        : context.transaction.status,
      reason: null,
      version: result.version,
      occurredAt: decidedAt.toISOString(),
    });
    return result;
  }

  private assertRequired(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }
}
