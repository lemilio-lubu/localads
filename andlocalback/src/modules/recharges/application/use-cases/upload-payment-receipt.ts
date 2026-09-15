import { ApplicationError } from "../../../../common/errors/application.error";
import { ReceiptUpload } from "../../domain/recharge.types";
import { TransactionPaymentStatus } from "../../domain/model/domain-status";
import { ReceiptProcessor } from "../ports/recharge.ports";
import {
  PaymentReceiptPersistencePort,
  TransactionReceiptSnapshot,
} from "../ports/transaction-verification.ports";

export type UploadPaymentReceiptCommand = Readonly<{
  paymentId: string;
  /** Future authenticated principal; optional only for the temporary demo adapter. */
  clientId?: string;
  file: ReceiptUpload;
}>;

/** Stores evidence only. OCR is dispatched explicitly after this use case succeeds. */
export class UploadPaymentReceipt {
  constructor(
    private readonly persistence: PaymentReceiptPersistencePort,
    private readonly receiptProcessor: ReceiptProcessor,
  ) {}

  async execute(command: UploadPaymentReceiptCommand): Promise<TransactionReceiptSnapshot> {
    this.assertRequired(command.paymentId, "PAYMENT_REQUIRED", "El pago es obligatorio");
    if (command.clientId !== undefined) {
      this.assertRequired(command.clientId, "CLIENT_REQUIRED", "El cliente no puede estar vacio");
    }
    const payment = await this.persistence.loadPaymentForReceipt(command.paymentId);
    if (!payment) throw new ApplicationError("PAYMENT_NOT_FOUND", "El pago no existe", 404);
    if (command.clientId !== undefined && payment.clientId !== command.clientId) {
      throw new ApplicationError("PAYMENT_NOT_OWNED", "El pago no pertenece al cliente", 409);
    }
    const allowed = new Set<string>([
      TransactionPaymentStatus.PENDING,
      TransactionPaymentStatus.IN_CREDIT,
      TransactionPaymentStatus.REJECTED,
      TransactionPaymentStatus.OVERDUE,
    ]);
    if (!allowed.has(payment.status)) {
      const code = payment.status === TransactionPaymentStatus.PAID
        ? "PAYMENT_ALREADY_CONFIRMED"
        : "PAYMENT_DOES_NOT_ACCEPT_RECEIPT";
      throw new ApplicationError(code, "El pago no admite otro comprobante", 409);
    }

    const stored = await this.receiptProcessor.process(command.file);
    return this.persistence.saveUploadedReceipt({
      paymentId: payment.id,
      expectedPaymentVersion: payment.version,
      receipt: {
        id: stored.id,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        size: stored.size,
        url: stored.url,
        checksum: stored.checksum,
      },
    });
  }

  private assertRequired(value: string, code: string, message: string): void {
    if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError(code, message);
  }
}
