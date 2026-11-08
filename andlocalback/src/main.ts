import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { assertSafeEnvironment, trustProxyHops } from "./common/config/environment";
import { createAppLogger, PinoNestLogger } from "./common/observability/logger";
import { requestLoggingMiddleware } from "./common/observability/request-logging.middleware";

async function bootstrap() {
  assertSafeEnvironment();
  /* Los logs del arranque se retienen hasta tener el logger JSON: asi todo
     sale en el mismo formato. */
  const logger = createAppLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(new PinoNestLogger(logger));
  app.set("trust proxy", trustProxyHops());
  app.use(requestLoggingMiddleware(logger));
  /* La API solo responde JSON y archivos: la politica por defecto de helmet
     (CSP cerrada, sin iframes, nosniff, HSTS) no estorba a nada. HSTS sin
     includeSubDomains: estas respuestas tambien llegan por el proxy de Next,
     con el dominio del portal, y no sabemos que subdominios cuelgan de el. */
  app.use(helmet({ strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false } }));
  app.useBodyParser("json", { limit: "100kb" });
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000", credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
