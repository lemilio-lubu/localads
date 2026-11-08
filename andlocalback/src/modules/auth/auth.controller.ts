import { Body, Controller, ForbiddenException, Get, Post, Req, Res } from "@nestjs/common";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { Request, Response } from "express";
import { AuthService, IssuedSession, MfaChallenge } from "./auth.service";
import { isDeployed } from "../../common/config/environment";
import { AllowsTemporaryPassword, CurrentUser, Public } from "./auth.decorators";
import { AuthPrincipal } from "./auth.types";
import { Throttle } from "@nestjs/throttler";
import { loginRateLimit, mfaRateLimit, passwordChangeRateLimit } from "./rate-limit";

class LoginDto { @IsString() @IsNotEmpty() @MaxLength(120) username!: string; @IsString() @IsNotEmpty() @MaxLength(200) password!: string; }
/* La politica de la clave nueva (largo, claves comunes) la aplica el servicio
   con un mensaje propio; aqui solo se acota el tamano. */
class ChangePasswordDto { @IsString() @IsNotEmpty() @MaxLength(200) currentPassword!: string; @IsString() @IsNotEmpty() @MaxLength(200) newPassword!: string; }
class MfaChallengeDto { @IsString() @IsNotEmpty() @MaxLength(2000) challengeToken!: string; }
class MfaCodeDto extends MfaChallengeDto { @IsString() @IsNotEmpty() @MaxLength(40) code!: string; }
class MfaEnrollDto { @IsString() @IsNotEmpty() @MaxLength(40) code!: string; }
class MfaDisableDto { @IsString() @IsNotEmpty() @MaxLength(200) password!: string; @IsString() @IsNotEmpty() @MaxLength(40) code!: string; }

/* En un despliegue la cookie lleva el prefijo __Secure- (el navegador la
   rechaza si no viaja por HTTPS) y SameSite=Strict: el front llama a la API
   por su propio origen, asi que nunca hace falta enviarla desde otro sitio.
   En local, por http, conserva el nombre de siempre. */
const legacyCookieName = "andlocal_refresh"; const cookiePath = "/api/v1/auth";
const cookieName = () => (isDeployed() ? "__Secure-andlocal_refresh" : legacyCookieName);
function readCookie(request: Request) { const name = cookieName(); const cookies = request.headers.cookie?.split(";").map((value) => value.trim().split("=")) ?? []; const value = cookies.find(([key]) => key === name)?.[1]; return value ? decodeURIComponent(value) : undefined; }
function assertTrustedOrigin(request: Request) {
  const origin = request.get("origin");
  const trustedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  if (origin && origin !== trustedOrigin) throw new ForbiddenException("Origen no permitido");
}
function setRefreshCookie(response: Response, session: IssuedSession) {
  const secure = isDeployed();
  response.cookie(cookieName(), session.refreshToken, { httpOnly: true, secure, sameSite: "strict", path: cookiePath, maxAge: session.refreshMaxAgeMs });
  /* La cookie anterior (sin prefijo, SameSite=None) se borra al primer uso. */
  if (secure) response.clearCookie(legacyCookieName, { path: cookiePath });
}
function clearRefreshCookie(response: Response) {
  response.clearCookie(cookieName(), { httpOnly: true, secure: isDeployed(), sameSite: "strict", path: cookiePath });
  if (isDeployed()) response.clearCookie(legacyCookieName, { path: cookiePath });
}
function sessionBody(session: IssuedSession) {
  return {
    accessToken: session.accessToken, expiresIn: session.expiresIn, user: { ...session.principal, displayName: session.displayName },
    ...(session.recoveryCodesLeft !== undefined ? { recoveryCodesLeft: session.recoveryCodesLeft } : {}),
  };
}
function loginBody(response: Response, result: IssuedSession | MfaChallenge) {
  if (result.kind === "mfa") return { mfaRequired: true, challengeToken: result.challengeToken };
  setRefreshCookie(response, result);
  return sessionBody(result);
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  /* Con el doble factor activo el login no abre sesion: devuelve un reto de
     5 minutos para el paso del codigo. */
  @Public() @Throttle(loginRateLimit()) @Post("login") async login(@Req() request: Request, @Body() body: LoginDto, @Res({ passthrough: true }) response: Response) { assertTrustedOrigin(request); return loginBody(response, await this.auth.login(body.username, body.password)); }
  @Public() @Throttle(mfaRateLimit) @Post("mfa/verify") async verifyMfa(@Req() request: Request, @Body() body: MfaCodeDto, @Res({ passthrough: true }) response: Response) { assertTrustedOrigin(request); return loginBody(response, await this.auth.verifyMfa(body.challengeToken, body.code)); }
  /* Activarlo y quitarlo se hace con la sesion abierta, desde su perfil. */
  @Get("mfa") mfaStatus(@CurrentUser() user: AuthPrincipal) { return this.auth.mfaStatus(user.userId); }
  @Throttle(passwordChangeRateLimit) @Post("mfa/enroll") startEnrollment(@CurrentUser() user: AuthPrincipal) { return this.auth.startEnrollment(user.userId); }
  @Throttle(passwordChangeRateLimit) @Post("mfa/enroll/confirm") confirmEnrollment(@CurrentUser() user: AuthPrincipal, @Body() body: MfaEnrollDto) { return this.auth.confirmEnrollment(user.userId, body.code); }
  @Throttle(passwordChangeRateLimit) @Post("mfa/disable") disableMfa(@CurrentUser() user: AuthPrincipal, @Body() body: MfaDisableDto) { return this.auth.disableMfa(user.userId, body.password, body.code); }
  @Public() @Post("refresh") async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) { assertTrustedOrigin(request); const token = readCookie(request); if (!token) return this.auth.refresh(""); const result = await this.auth.refresh(token); setRefreshCookie(response, result); return sessionBody(result); }
  @Public() @Post("logout") async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { assertTrustedOrigin(request); await this.auth.logout(readCookie(request)); clearRefreshCookie(response); return { success: true }; }
  @AllowsTemporaryPassword() @Get("me") async me(@CurrentUser() user: AuthPrincipal) { return { user: { ...user, displayName: await this.auth.displayName(user) } }; }
  /* Unica ruta que una cuenta con clave temporal puede usar ademas de /me.
     Cierra la sesion despues de cambiarla: los refresh quedan revocados. */
  @AllowsTemporaryPassword() @Throttle(passwordChangeRateLimit) @Post("password") async changePassword(@CurrentUser() user: AuthPrincipal, @Body() body: ChangePasswordDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.changePassword(user.userId, body.currentPassword, body.newPassword);
    clearRefreshCookie(response);
    return result;
  }
}
