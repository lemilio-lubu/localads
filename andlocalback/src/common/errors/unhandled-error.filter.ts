import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { BaseWsExceptionFilter } from "@nestjs/websockets";
import { Request, Response } from "express";
import { serializeError } from "../observability/logger";
import { RequestContext } from "../observability/request-context";
import { ApplicationError } from "./application.error";

export const unexpectedErrorMessage = "Ocurrió un error inesperado. Si se repite, comparte el código de referencia con soporte";

/* Ultima red de la API (APP_FILTER). Los filtros de cada controller -como
   ApplicationErrorFilter- van antes y se quedan con lo suyo; aqui llega el
   resto:
   - HttpException (validacion, 401, 403, 404, 429...): la misma respuesta que
     daba Nest.
   - ApplicationError lanzado desde un controller sin su filtro: su estado y
     su codigo, no un 500.
   - Cualquier otra cosa (Prisma, un TypeError, un fallo de R2): 500 generico
     con el requestId. El detalle se queda en el log del servidor. */
@Catch()
export class UnhandledErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");
  private readonly websocket = new BaseWsExceptionFilter();

  catch(error: unknown, host: ArgumentsHost) {
    if (host.getType() === "ws") { this.websocket.catch(error, host); return; }
    if (host.getType() !== "http") throw error;
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.current()?.requestId;
    const where = { method: request.method, path: request.originalUrl?.split("?")[0] };

    /* Un archivo a medio enviar ya no admite otra respuesta: solo queda
       registrarlo y cortar. */
    if (response.headersSent) {
      this.logger.error({ msg: "Error con la respuesta ya enviada", ...where, error: serializeError(error) });
      response.end();
      return;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status >= 500) this.logger.error({ msg: "Error HTTP del servidor", ...where, status, error: serializeError(error) });
      const body = error.getResponse();
      response.status(status).json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }

    if (error instanceof ApplicationError) {
      response.status(error.status).json({ statusCode: error.status, code: error.code, message: error.message });
      return;
    }

    this.logger.error({ msg: "Error no controlado", ...where, error: serializeError(error) });
    response.status(500).json({ statusCode: 500, code: "INTERNAL_ERROR", message: unexpectedErrorMessage, ...(requestId ? { requestId } : {}) });
  }
}
