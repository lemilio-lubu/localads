import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Param, Patch, Post, UploadedFile, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApplicationError } from "../../../common/errors/application.error";
import { TransactionReceiptOcrDispatcher } from "../application/services/transaction-receipt-ocr-dispatcher";
import { ApproveTransactionVerification } from "../application/use-cases/approve-transaction-verification";
import { ProcessTransactionReceiptOcr } from "../application/use-cases/process-transaction-receipt-ocr";
import { RejectTransactionVerification } from "../application/use-cases/reject-transaction-verification";
import { MarkTransactionVerificationUnderReview } from "../application/use-cases/mark-transaction-verification-under-review";
import { UploadPaymentReceipt } from "../application/use-cases/upload-payment-receipt";
import { ApplicationErrorFilter } from "./application-error.filter";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { PrismaService } from "../../../database/prisma.service";
import {
  ApproveTransactionVerificationDto,
  RejectTransactionVerificationDto,
  ReviewTransactionVerificationDto,
} from "./dto/transaction-verification-decision.dto";

@Controller()
@UseFilters(ApplicationErrorFilter)
export class TransactionVerificationsController {
  constructor(
    private readonly processReceiptOcr: ProcessTransactionReceiptOcr,
    private readonly approveVerification: ApproveTransactionVerification,
    private readonly rejectVerification: RejectTransactionVerification,
    private readonly uploadReceipt: UploadPaymentReceipt,
    private readonly ocrDispatcher: TransactionReceiptOcrDispatcher,
    private readonly database: PrismaService,
    private readonly markVerificationUnderReview: MarkTransactionVerificationUnderReview,
  ) {}

  @Post("transaction-receipts/:receiptId/ocr")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  processOrRetryOcr(@Param("receiptId") receiptId: string) {
    return this.processReceiptOcr.execute({ receiptId });
  }

  @Patch("transaction-verifications/:verificationId/approve")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  approve(
    @Param("verificationId") verificationId: string,
    @Body() body: ApproveTransactionVerificationDto,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    return this.approveVerification.execute({ verificationId, notes: body.notes, administratorId: user?.userId ?? body.administratorId });
  }

  @Patch("transaction-verifications/:verificationId/reject")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  reject(
    @Param("verificationId") verificationId: string,
    @Body() body: RejectTransactionVerificationDto,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    return this.rejectVerification.execute({ verificationId, reason: body.reason, administratorId: user?.userId ?? body.administratorId });
  }

  @Patch("transaction-verifications/:verificationId/review")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  review(
    @Param("verificationId") verificationId: string,
    @Body() body: ReviewTransactionVerificationDto,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    return this.markVerificationUnderReview.execute({
      verificationId,
      reason: body.reason,
      administratorId: user?.userId ?? body.administratorId,
    });
  }

  @Post("payments/:paymentId/receipts")
  @Roles("CLIENT")
  @UseInterceptors(FileInterceptor("receipt", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async addPaymentReceipt(
    @Param("paymentId") paymentId: string,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    if (!file) throw new ApplicationError("RECEIPT_REQUIRED", "Debes adjuntar un comprobante valido");
    if (user) {
      const payment = await this.database.payment.findUnique({ where: { id: paymentId }, select: { transaction: { select: { clientId: true } } } });
      if (!user.clientId || payment?.transaction.clientId !== user.clientId) throw new ForbiddenException("No puedes cargar comprobantes para este pago");
    }
    const receipt = await this.uploadReceipt.execute({
      paymentId,
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
    });
    this.ocrDispatcher.dispatch(receipt.id);
    return receipt;
  }
}
