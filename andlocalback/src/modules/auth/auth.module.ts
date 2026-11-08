import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard, RolesGuard, TemporaryPasswordGuard } from "./auth.guards";
import { CredentialsService } from "./credentials.service";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SecureFilesController } from "./secure-files.controller";
import { StorageModule } from "../storage/storage.module";
import { ThrottlerModule } from "@nestjs/throttler";
import { RateLimitGuard, rateLimitOptions } from "./rate-limit";
import { MfaSecretCipher } from "./mfa-secret-cipher";
import { SessionStateService } from "./session-state.service";
import { AuditModule } from "../../common/audit/audit.module";

/* Orden de los guards: autenticar, limitar solicitudes (ya con el usuario
   conocido), comprobar rol y, por ultimo, bloquear a quien arrastra una
   clave temporal sin cambiar. */
@Module({ imports: [AuditModule, StorageModule, ThrottlerModule.forRoot(rateLimitOptions())], controllers: [AuthController, SecureFilesController], providers: [AccessTokenService, PasswordService, AuthService, CredentialsService, MfaSecretCipher, SessionStateService, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RateLimitGuard }, { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: TemporaryPasswordGuard }], exports: [AccessTokenService, CredentialsService, SessionStateService] })
export class AuthModule {}
