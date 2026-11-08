import { LoggerService } from "@nestjs/common";
import pino from "pino";
import { RequestContext } from "./request-context";

/* Campos que nunca se escriben, ni arriba ni un nivel por debajo. Es la red
   de seguridad: el log de peticiones ya solo lleva campos permitidos (sin
   cabeceras, cuerpo ni query) y ningun servicio deberia pasar estos datos,
   pero si alguno lo hace, aqui se tapan. */
const sensitiveKeys = [
  "password", "currentPassword", "newPassword", "passwordHash", "temporaryPassword",
  "accessToken", "refreshToken", "challengeToken", "token", "secret", "mfaSecret", "recoveryCodes",
  "authorization", "cookie", "set-cookie",
  "bankReference", "bankReferenceNormalized", "accountNumber", "clientSecret",
];
export const redactedPaths = [
  ...sensitiveKeys.map((key) => (/^[A-Za-z]+$/.test(key) ? key : `["${key}"]`)),
  ...sensitiveKeys.map((key) => (/^[A-Za-z]+$/.test(key) ? `*.${key}` : `*["${key}"]`)),
  "*.headers.authorization", "*.headers.cookie",
];

const levels = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

/* JSON de una linea por evento, con requestId y userId de la peticion en
   curso. Railway los guarda tal cual y permite filtrar por cualquier campo. */
export function createAppLogger(env: NodeJS.ProcessEnv = process.env, destination?: pino.DestinationStream): pino.Logger {
  const level = env.LOG_LEVEL && levels.has(env.LOG_LEVEL) ? env.LOG_LEVEL : "info";
  return pino({
    level,
    base: { service: "andlocalback" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: redactedPaths, censor: "[oculto]" },
    mixin() {
      const context = RequestContext.current();
      return context ? { requestId: context.requestId, ...(context.userId ? { userId: context.userId } : {}) } : {};
    },
  }, destination);
}

/* El detalle de un error para el log del servidor, nunca para la respuesta.
   Los errores de Prisma no llevan su mensaje: el de validacion copia los
   argumentos de la consulta, y ahi puede ir un hash de clave o un dato
   personal. Su codigo y su meta (tabla, columna) bastan para diagnosticar. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error).slice(0, 500) };
  const prisma = error.name.startsWith("PrismaClient");
  const stack = error.stack?.split("\n").filter((line) => line.trimStart().startsWith("at ")).slice(0, 15).join("\n");
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  return {
    type: error.name,
    ...(prisma ? {} : { message: error.message.slice(0, 1000) }),
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(prisma && meta ? { meta } : {}),
    ...(stack ? { stack } : {}),
  };
}

type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/* Adapta el Logger de Nest (lo que usan los runners y el propio framework) a
   pino. Nest pasa el contexto -el nombre de la clase- como ultimo argumento
   de texto, y en error() la traza va justo antes. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: pino.Logger) {}

  log(message: unknown, ...params: unknown[]) { this.write("info", message, params); }
  warn(message: unknown, ...params: unknown[]) { this.write("warn", message, params); }
  debug(message: unknown, ...params: unknown[]) { this.write("debug", message, params); }
  verbose(message: unknown, ...params: unknown[]) { this.write("trace", message, params); }
  fatal(message: unknown, ...params: unknown[]) { this.write("fatal", message, params); }

  error(message: unknown, ...params: unknown[]) {
    const { context, rest } = splitContext(params);
    if (message instanceof Error) { this.logger.error({ context, error: serializeError(message) }, "Error no controlado"); return; }
    const stack = typeof rest[0] === "string" && rest[0].includes("\n") ? rest[0] : undefined;
    this.write("error", message, [], context, stack ? { stack } : {});
  }

  private write(level: Level, message: unknown, params: unknown[], context = splitContext(params).context, extra: Record<string, unknown> = {}) {
    if (message instanceof Error) { this.logger[level]({ context, ...extra, error: serializeError(message) }, "Error no controlado"); return; }
    if (typeof message === "object" && message !== null) { this.logger[level]({ context, ...extra, ...message }); return; }
    this.logger[level]({ context, ...extra }, String(message));
  }
}

function splitContext(params: unknown[]): { context: string | undefined; rest: unknown[] } {
  const last = params.at(-1);
  /* Una traza (con saltos de linea) nunca es el contexto. */
  return typeof last === "string" && !last.includes("\n") ? { context: last, rest: params.slice(0, -1) } : { context: undefined, rest: params };
}
