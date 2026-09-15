import { ApplicationError } from "../../../../common/errors/application.error";
import { PaymentStatus, ReceiptUpload, VerificationStatus } from "../../domain/recharge.types";
import { OcrProcessor, ReceiptProcessor, RechargeRepository, TransactionRealtimePublisher } from "../ports/recharge.ports";

const minimumOcrConfidence = 80;

export class ReplacePrepaidReceipt {
  constructor(
    private readonly recharges: RechargeRepository,
    private readonly receiptProcessor: ReceiptProcessor,
    private readonly ocrProcessor: OcrProcessor,
    private readonly realtime: TransactionRealtimePublisher = { publish: () => undefined },
  ) {}

  async execute(rechargeId: string, upload: ReceiptUpload) {
    const recharge = await this.recharges.findById(rechargeId);
    if (!recharge) throw new ApplicationError("RECHARGE_NOT_FOUND", "La recarga no existe", 404);
    if (recharge.paymentStatus !== PaymentStatus.REJECTED || recharge.verification?.status !== VerificationStatus.REJECTED) {
      throw new ApplicationError("RECEIPT_RETRY_NOT_ALLOWED", "Sólo puedes reemplazar un comprobante después de un rechazo", 409);
    }

    const receipt = await this.receiptProcessor.process(upload);
    recharge.addReceipt(receipt);
    try {
      recharge.submitPrepaidForReview(await this.ocrProcessor.process(upload), minimumOcrConfidence);
    } catch (error) {
      recharge.recordOcrFailure(error instanceof Error ? error.message : "Error técnico no identificado durante el OCR");
    }
    await this.recharges.save(recharge);
    const result = recharge.toPrimitives();
    this.realtime.publish({ change: "UPDATED", transaction: result });
    return result;
  }
}
