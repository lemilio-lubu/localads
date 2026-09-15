import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard, RolesGuard } from "./auth.guards";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SecureFilesController } from "./secure-files.controller";

@Module({ controllers: [AuthController, SecureFilesController], providers: [AccessTokenService, PasswordService, AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }], exports: [AccessTokenService] })
export class AuthModule {}
