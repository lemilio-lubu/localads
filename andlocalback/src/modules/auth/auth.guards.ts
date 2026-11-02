import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service";
import { ALLOWS_TEMPORARY_PASSWORD_KEY, IS_PUBLIC_KEY, ROLES_KEY } from "./auth.decorators";
import { AccessPayload, AuthPrincipal, AuthRole } from "./auth.types";
import { SessionStateService } from "./session-state.service";

/* Autentica y, ademas, comprueba que el token siga vigente para su usuario
   (activo, mismo rol, misma version): ver SessionStateService. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: AccessTokenService, private readonly sessions: SessionStateService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (context.getType() === "ws") {
      const client = context.switchToWs().getClient<{
        data?: { user?: AuthPrincipal };
        handshake?: { auth?: { accessToken?: unknown } };
      }>();
      if (client.data?.user) return true;
      const raw = client.handshake?.auth?.accessToken;
      if (typeof raw !== "string") throw new UnauthorizedException("Debes iniciar sesión");
      const user = await this.current(raw);
      client.data ??= {};
      client.data.user = user;
      return true;
    }
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthPrincipal }>();
    const authorization = request.headers.authorization; const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value?.startsWith("Bearer ")) throw new UnauthorizedException("Debes iniciar sesión");
    request.user = await this.current(value.slice(7));
    return true;
  }

  private async current(raw: string): Promise<AccessPayload> {
    let payload: AccessPayload;
    try { payload = this.tokens.verify(raw); } catch { throw new UnauthorizedException("La sesión expiró o no es válida"); }
    if (!(await this.sessions.isCurrent(payload))) throw new UnauthorizedException("La sesión ya no es válida");
    return payload;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AuthRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]); if (!roles?.length) return true;
    const user = context.getType() === "ws"
      ? context.switchToWs().getClient<{ data?: { user?: AuthPrincipal } }>().data?.user
      : context.switchToHttp().getRequest<{ user?: AuthPrincipal }>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException("No tienes permisos para esta operación"); return true;
  }
}

/* Una clave temporal sirve para entrar y para nada mas. El token es valido
   -por eso esto no es un 401- pero la cuenta no puede operar hasta cambiarla.
   El frontend decide sobre el codigo, nunca sobre el texto del mensaje. */
@Injectable()
export class TemporaryPasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOWS_TEMPORARY_PASSWORD_KEY, [context.getHandler(), context.getClass()])) return true;
    const user = context.getType() === "ws"
      ? context.switchToWs().getClient<{ data?: { user?: AuthPrincipal } }>().data?.user
      : context.switchToHttp().getRequest<{ user?: AuthPrincipal }>().user;
    if (user?.mustChangePassword) throw new ForbiddenException({ code: "PASSWORD_CHANGE_REQUIRED", message: "Debes cambiar tu contraseña temporal antes de continuar" });
    return true;
  }
}
