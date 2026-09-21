import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard, RolesGuard, TemporaryPasswordGuard } from "./auth.guards";
import { CredentialsService } from "./credentials.service";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SecureFilesController } from "./secure-files.controller";

/* Orden de los guards: autenticar, comprobar rol y, por ultimo, bloquear a
   quien arrastra una clave temporal sin cambiar. */
@Module({ controllers: [AuthController, SecureFilesController], providers: [AccessTokenService, PasswordService, AuthService, CredentialsService, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: TemporaryPasswordGuard }], exports: [AccessTokenService, CredentialsService] })
export class AuthModule {}
