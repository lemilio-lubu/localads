import { ApplicationError } from "../../../../common/errors/application.error";
import { TransactionVerificationPolicy } from "../../domain/policies/transaction-verification.policy";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../../domain/model/domain-status";
import { VerificationIssue } from "../../domain/recharge.types";
import { MonetaryAmount } from "../../domain/value-objects/monetary-amount";
import { IdGenerator } from "../ports/recharge.ports";
import {
  ExtractedTransactionReceiptData,
  ReceiptProcessingContext,
  TransactionReceiptOcrPort,
  TransactionVerificationPersistencePort,
  TransactionVerificationView,
  VerificationRealtimePublisher,
} from "../ports/transaction-verification.ports";

export type ProcessTransactionReceiptOcrCommand = Readonly<{ receiptId: string }>;

/** Explicit system dispatcher. It is intentionally not coupled to SolicitarRecarga. */
export class ProcessTransactionReceiptOcr {
  constructor(
    private readonly persistence: TransactionVerificationPersistencePort,
    private readonly ocr: TransactionReceiptOcrPort,
    private readonly ids: IdGenerator,
    private readonly policy = new TransactionVerificationPolicy(),
    private readonly now: () => Date = () => new Date(),
    private readonly realtime: VerificationRealtimePublisher = { publishVerification: () => undefined },
  ) {}

  async execute(command: ProcessTransactionReceiptOcrCommand): Promise<TransactionVerificationView> {
    this.assertRequired(command.receiptId, "RECEIPT_REQUIRED", "El comprobante es obligatorio");
    const context = await this.persistence.loadReceiptContext(command.receiptId);
    if (!context) throw new ApplicationError("RECEIPT_NOT_FOUND", "El comprobante no existe", 404);
    if (context.existingVerification) return context.existingVerification;
    if (context.payment.status !== "UNDER_REVIEW") {
      throw new ApplicationError("PAYMENT_NOT_UNDER_REVIEW", "El pago debe estar en revision", 409);
    }
    if (context.receipt.status !== "LOADED") {
      throw new ApplicationError("RECEIPT_NOT_PROCESSABLE", "El comprobante no puede procesarse desde su estado actual", 409);
    }

    const ocrResultId = this.ids.generate();
    const verificationId = this.ids.generate();
    let analysis: Awaited<ReturnType<TransactionReceiptOcrPort["process"]>>;
    try {
      analysis = await this.ocr.process(context.receipt);
    } catch (error) {
      const result = await this.persistence.saveOcrFailure({
        context,
        ocrResultId,
        verificationId,
        failureReason: this.failureMessage(error),
      });
      this.publishResult(context, result, "No fue posible leer el comprobante automáticamente");
      return result;
    }

    const duplicates = await this.persistence.findConfirmedDuplicates({
      excludePaymentId: context.payment.id,
      checksum: context.receipt.checksum,
      transactionCode: analysis.bankReference,
    });
    const evaluatedAt = this.now();
    const evaluation = this.policy.evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits(context.payment.expectedAmount),
      ocr: analysis,
      receiptAlreadyConfirmed: duplicates.checksumUsed,
      bankReferenceAlreadyConfirmed: duplicates.transactionCodeUsed,
      evaluatedAt,
    });

    const result = await this.persistence.saveOcrEvaluation({
      context,
      ocrResultId,
      verificationId,
      extracted: this.toPersistenceData(analysis, evaluation.detectedAmount?.toSafeNumber() ?? null),
      evaluation: {
        status: evaluation.status,
        amountMatches: evaluation.amountMatches,
        issues: evaluation.issues,
        requiresManualReview: evaluation.requiresAdministratorApproval,
      },
    });
    this.publishResult(context, result, this.reviewReason(result.issues));
    return result;
  }

  private publishResult(
    context: ReceiptProcessingContext,
    result: TransactionVerificationView,
    reason: string | null,
  ): void {
    this.realtime.publishVerification({
      eventId: `${result.id}:${result.version}`,
      verificationId: result.id,
      transactionId: context.transaction.id,
      accountId: context.transaction.accountId,
      status: result.status,
      paymentStatus: context.payment.status as TransactionPaymentStatus,
      rechargeStatus: context.transaction.status as TransactionRechargeStatus,
      reason,
      version: result.version,
      occurredAt: this.now().toISOString(),
    });
  }

  private reviewReason(issues: readonly VerificationIssue[]): string | null {
    if (issues.length === 0) return null;
    const labels: Record<VerificationIssue, string> = {
      [VerificationIssue.AMOUNT_MISMATCH]: "El monto detectado no coincide con el solicitado",
      [VerificationIssue.AMOUNT_NOT_FOUND]: "No se pudo detectar el monto",
      [VerificationIssue.LOW_CONFIDENCE]: "La lectura automática tiene baja confianza",
      [VerificationIssue.OCR_FAILURE]: "No fue posible leer el comprobante automáticamente",
      [VerificationIssue.BANK_NOT_IDENTIFIED]: "No se pudo identificar el banco",
      [VerificationIssue.BANK_REFERENCE_NOT_IDENTIFIED]: "No se pudo identificar la referencia bancaria",
      [VerificationIssue.DATE_OUT_OF_RANGE]: "La fecha detectada requiere revisión",
      [VerificationIssue.DUPLICATE_RECEIPT]: "El comprobante podría estar duplicado",
      [VerificationIssue.DUPLICATE_BANK_REFERENCE]: "La referencia bancaria podría estar duplicada",
    };
    return issues.map((issue) => labels[issue]).join(". ");
  }

  private toPersistenceData(
    analysis: Awaited<ReturnType<TransactionReceiptOcrPort["process"]>>,
    detectedAmount: number | null,
  ): ExtractedTransactionReceiptData {
    return {
      bank: analysis.bank,
      detectedAmount,
      detectedDate: analysis.transactionDate,
      transactionCode: analysis.bankReference,
      originator: analysis.orderingParty,
      confidence: analysis.confidence,
      rawText: analysis.originalText,
    };
  }

  private failureMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "El OCR no pudo procesar el comprobante";
  }

  private assertRequired(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }
}
