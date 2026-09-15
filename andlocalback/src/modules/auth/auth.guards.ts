import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service";
import { IS_PUBLIC_KEY, ROLES_KEY } from "./auth.decorators";
import { AuthPrincipal, AuthRole } from "./auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: AccessTokenService) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (context.getType() === "ws") {
      const client = context.switchToWs().getClient<{
        data?: { user?: AuthPrincipal };
        handshake?: { auth?: { accessToken?: unknown } };
      }>();
      if (client.data?.user) return true;
      const raw = client.handshake?.auth?.accessToken;
      if (typeof raw !== "string") throw new UnauthorizedException("Debes iniciar sesión");
      try {
        const user = this.tokens.verify(raw);
        client.data ??= {};
        client.data.user = user;
        return true;
      } catch {
        throw new UnauthorizedException("La sesión expiró o no es válida");
      }
    }
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthPrincipal }>();
    const authorization = request.headers.authorization; const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value?.startsWith("Bearer ")) throw new UnauthorizedException("Debes iniciar sesión");
    try { request.user = this.tokens.verify(value.slice(7)); return true; } catch { throw new UnauthorizedException("La sesión expiró o no es válida"); }
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
