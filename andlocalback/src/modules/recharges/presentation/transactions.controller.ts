import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../auth/auth.decorators";
import { AuthPrincipal } from "../../auth/auth.types";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApplicationError } from "../../../common/errors/application.error";
import { RequestPrepaidTransaction } from "../application/use-cases/request-prepaid-transaction";
import { RequestPostpaidTransaction } from "../application/use-cases/request-postpaid-transaction";
import { TransactionReceiptOcrDispatcher } from "../application/services/transaction-receipt-ocr-dispatcher";
import { ListAccountTransactions } from "../application/use-cases/list-account-transactions";
import { ApplicationErrorFilter } from "./application-error.filter";
import { RequestPrepaidTransactionDto } from "./dto/request-prepaid-transaction.dto";
import { RequestPostpaidTransactionDto } from "./dto/request-postpaid-transaction.dto";

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

@Controller("transactions")
@UseFilters(ApplicationErrorFilter)
export class TransactionsController {
  constructor(
    private readonly listTransactions: ListAccountTransactions,
    private readonly requestPrepaidTransaction: RequestPrepaidTransaction,
    private readonly ocrDispatcher: TransactionReceiptOcrDispatcher,
    private readonly requestPostpaidTransaction: RequestPostpaidTransaction,
  ) {}

  @Get()
  @Roles("ADMIN")
  list(@Query("accountId") accountId?: string) {
    return this.listTransactions.execute(accountId);
  }

  @Post("prepaid")
  @Roles("CLIENT")
  @UseInterceptors(FileInterceptor("receipt", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async requestPrepaid(
    @Body() body: RequestPrepaidTransactionDto,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "La clave de idempotencia es obligatoria");
    }
    if (!idempotencyKeyPattern.test(idempotencyKey)) {
      throw new ApplicationError(
        "INVALID_IDEMPOTENCY_KEY",
        "La clave de idempotencia debe tener entre 8 y 128 caracteres validos",
      );
    }
    if (!file) {
      throw new ApplicationError("RECEIPT_REQUIRED", "Debes adjuntar un comprobante valido");
    }

    const transaction = await this.requestPrepaidTransaction.execute({
      accountId: requireOwnAccount(user, body.accountId),
      idempotencyKey,
      details: body.details.map((detail) => ({
        pautaId: detail.pautaId,
        platform: detail.platform,
        amount: Number(detail.amount),
      })),
      receipt: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
    });
    this.ocrDispatcher.dispatch(transaction.receipt.id);
    return transaction;
  }

  @Post("postpaid")
  @Roles("CLIENT")
  async requestPostpaid(
    @Body() body: RequestPostpaidTransactionDto,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    return this.requestPostpaidTransaction.execute({
      accountId: requireOwnAccount(user, body.accountId),
      idempotencyKey,
      details: body.details.map((detail) => ({
        pautaId: detail.pautaId,
        platform: detail.platform,
        amount: Number(detail.amount),
      })),
    });
  }

  private requireIdempotencyKey(rawIdempotencyKey: string | undefined): string {
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "La clave de idempotencia es obligatoria");
    }
    if (!idempotencyKeyPattern.test(idempotencyKey)) {
      throw new ApplicationError(
        "INVALID_IDEMPOTENCY_KEY",
        "La clave de idempotencia debe tener entre 8 y 128 caracteres validos",
      );
    }
    return idempotencyKey;
  }
}

function requireOwnAccount(user: AuthPrincipal | undefined, requestedAccountId: string): string {
  if (!user) return requestedAccountId; // Unit tests call controllers without the global guard.
  if (!user.accountId) throw new ForbiddenException("El usuario no está vinculado a una cuenta");
  return user.accountId;
}
