import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Response } from "express";
import { MulterError } from "multer";
import { ApplicationError } from "../../../common/errors/application.error";
import { DomainError } from "../domain/core/domain-error";

@Catch(ApplicationError, DomainError, Prisma.PrismaClientKnownRequestError, MulterError)
export class ApplicationErrorFilter implements ExceptionFilter {
  catch(error: ApplicationError | DomainError | Prisma.PrismaClientKnownRequestError | MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof ApplicationError) {
      response.status(error.status).json({
        statusCode: error.status,
        code: error.code,
        message: error.message,
      });
      return;
    }

    if (error instanceof DomainError) {
      const status = domainConflictCodes.has(error.code) ? 409 : 400;
      response.status(status).json({ statusCode: status, code: error.code, message: error.message });
      return;
    }

    if (error instanceof MulterError) {
      const code = error.code === "LIMIT_FILE_SIZE" ? "RECEIPT_TOO_LARGE" : "INVALID_RECEIPT_UPLOAD";
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "El comprobante supera el limite de 5 MB"
        : "No fue posible cargar el comprobante";
      response.status(400).json({ statusCode: 400, code, message });
      return;
    }

    // Database internals must never leak through the public HTTP contract.
    const status = error.code === "P2002" ? 409 : 400;
    const code = error.code === "P2002" ? "RESOURCE_CONFLICT" : "PERSISTENCE_ERROR";
    response.status(status).json({
      statusCode: status,
      code,
      message: error.code === "P2002" ? "El recurso ya existe" : "No fue posible guardar la operacion",
    });
  }
}

const domainConflictCodes = new Set([
  "DUPLICATE_PAUTA",
  "INVALID_TRANSACTION_TRANSITION",
  "PAUTA_NOT_ACTIVE",
  "PAYMENT_ALREADY_CONFIRMED",
]);
