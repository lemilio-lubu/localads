import { ApplicationError } from "../../../../common/errors/application.error";
import { VerificationStatus } from "../../domain/recharge.types";
import {
  TransactionVerificationPersistencePort,
  TransactionVerificationView,
  VerificationRealtimePublisher,
} from "../ports/transaction-verification.ports";

export type MarkTransactionVerificationUnderReviewCommand = Readonly<{
  verificationId: string;
  administratorId: string;
  reason: string;
}>;

/** Records a manual-review decision without rejecting any financial evidence. */
export class MarkTransactionVerificationUnderReview {
  constructor(
    private readonly persistence: TransactionVerificationPersistencePort,
    private readonly now: () => Date = () => new Date(),
    private readonly realtime: VerificationRealtimePublisher = { publishVerification: () => undefined },
  ) {}

  async execute(command: MarkTransactionVerificationUnderReviewCommand): Promise<TransactionVerificationView> {
    const verificationId = this.required(command.verificationId, "VERIFICATION_REQUIRED", "La verificacion es obligatoria");
    const administratorId = this.required(command.administratorId, "ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    const reason = this.required(command.reason, "REVIEW_REASON_REQUIRED", "El motivo de revision es obligatorio");
    const context = await this.persistence.loadVerificationContext(verificationId);
    if (!context) throw new ApplicationError("VERIFICATION_NOT_FOUND", "La verificacion no existe", 404);
    if (context.verification.status !== VerificationStatus.AUTOMATICALLY_VERIFIED &&
        context.verification.status !== VerificationStatus.UNDER_REVIEW) {
      throw new ApplicationError("VERIFICATION_ALREADY_RESOLVED", "La verificacion ya fue resuelta", 409);
    }

    // An identical retry is a no-op: it creates no duplicate audit entry and
    // does not advance the optimistic-lock version.
    if (context.verification.status === VerificationStatus.UNDER_REVIEW && context.verification.reviewReason === reason) {
      return context.verification;
    }

    const reviewedAt = this.now();
    const result = await this.persistence.markUnderReviewAtomically({
      context,
      administratorId,
      reason,
      reviewedAt,
    });
    this.realtime.publishVerification({
      eventId: `${result.id}:${result.version}`,
      verificationId: result.id,
      transactionId: context.transaction.id,
      accountId: context.transaction.accountId,
      status: result.status,
      paymentStatus: context.payment.status,
      rechargeStatus: context.transaction.status,
      reason,
      version: result.version,
      occurredAt: reviewedAt.toISOString(),
    });
    return result;
  }

  private required(value: string, code: string, message: string): string {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
    return value.trim();
  }
}
