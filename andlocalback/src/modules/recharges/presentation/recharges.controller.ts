import { Body, Controller, Post, UploadedFile, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApplicationError } from "../../../common/errors/application.error";
import { CreatePrepaidRecharge } from "../application/use-cases/create-prepaid-recharge";
import { ApplicationErrorFilter } from "./application-error.filter";
import { CreatePrepaidRechargeDto } from "./dto/create-prepaid-recharge.dto";
import { Roles } from "../../auth/auth.decorators";

@Controller("prepaid-recharges")
@UseFilters(ApplicationErrorFilter)
@Roles("ADMIN")
export class PrepaidRechargesController {
  constructor(private readonly createRecharge: CreatePrepaidRecharge) {}

  @Post()
  @UseInterceptors(FileInterceptor("receipt", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async create(@Body() body: CreatePrepaidRechargeDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApplicationError("RECEIPT_REQUIRED", "Debes adjuntar un comprobante válido");

    return this.createRecharge.execute({
      ...body,
      receipt: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
    });
  }

}
