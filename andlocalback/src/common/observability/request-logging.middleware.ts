import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import type pino from "pino";
import { RequestContext, RequestContextState } from "./request-context";

/* Primer middleware de la API. Da a cada peticion un requestId (que vuelve en
   la cabecera X-Request-Id y en cualquier 500), abre su contexto y, al
   terminar, escribe una linea con lo justo para investigar un incidente.

   El id se genera siempre aqui: aceptar el que mande el cliente le dejaria
   mezclar sus peticiones con las de otro en los logs.

   Solo campos permitidos: ni cabeceras, ni cuerpo, ni query (alli viajan
   busquedas por RUC o correo). La IP es la real porque main.ts configura
   trust proxy antes de montar esto. */
export function requestLoggingMiddleware(logger: pino.Logger) {
  return (request: Request, response: Response, next: NextFunction) => {
    const state: RequestContextState = {
      requestId: randomUUID(),
      ip: request.ip ?? null,
      userAgent: request.get("user-agent")?.slice(0, 300) ?? null,
      userId: null,
    };
    response.setHeader("X-Request-Id", state.requestId);
    const started = process.hrtime.bigint();
    response.on("finish", () => {
      const status = response.statusCode;
      const path = request.originalUrl.split("?")[0];
      const entry = {
        requestId: state.requestId, ...(state.userId ? { userId: state.userId } : {}),
        method: request.method, path, status,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        ip: state.ip, userAgent: state.userAgent,
      };
      /* El health lo consulta Railway cada pocos segundos: no ensucia el log. */
      if (path.endsWith("/health")) logger.debug(entry, "petición");
      else if (status >= 500) logger.error(entry, "petición");
      else if (status >= 400) logger.warn(entry, "petición");
      else logger.info(entry, "petición");
    });
    RequestContext.run(state, next);
  };
}
