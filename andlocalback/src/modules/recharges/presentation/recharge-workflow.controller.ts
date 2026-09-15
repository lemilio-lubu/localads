import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post, UploadedFile, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApplicationError } from "../../../common/errors/application.error";
import { ApprovePrepaidVerification } from "../application/use-cases/approve-prepaid-verification";
import { MoveRechargeToProcessing } from "../application/use-cases/move-recharge-to-processing";
import { RejectPrepaidVerification } from "../application/use-cases/reject-prepaid-verification";
import { ReplacePrepaidReceipt } from "../application/use-cases/replace-prepaid-receipt";
import { ApplicationErrorFilter } from "./application-error.filter";
import { ApproveVerificationDto, RejectVerificationDto } from "./dto/verification-decision.dto";
import { Roles } from "../../auth/auth.decorators";

@Controller("recharges")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN")
export class RechargeWorkflowController {
  constructor(
    private readonly moveToProcessing: MoveRechargeToProcessing,
    private readonly approveVerification: ApprovePrepaidVerification,
    private readonly rejectVerification: RejectPrepaidVerification,
    private readonly replaceReceipt: ReplacePrepaidReceipt,
  ) {}

  @Patch(":id/verification/approve")
  @HttpCode(HttpStatus.OK)
  approvePrepaid(@Param("id") id: string, @Body() body: ApproveVerificationDto) {
    return this.approveVerification.execute(id, body.administratorId);
  }

  @Patch(":id/verification/reject")
  @HttpCode(HttpStatus.OK)
  rejectPrepaid(@Param("id") id: string, @Body() body: RejectVerificationDto) {
    return this.rejectVerification.execute(id, body.administratorId, body.reason);
  }

  @Post(":id/receipts")
  @UseInterceptors(FileInterceptor("receipt", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  replacePrepaidReceipt(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApplicationError("RECEIPT_REQUIRED", "Debes adjuntar un comprobante válido");
    return this.replaceReceipt.execute(id, {
      originalName: file.originalname, mimeType: file.mimetype, size: file.size, buffer: file.buffer,
    });
  }

  @Patch(":id/processing")
  @HttpCode(HttpStatus.OK)
  moveToProcessingState(@Param("id") id: string) {
    return this.moveToProcessing.execute(id);
  }
}
