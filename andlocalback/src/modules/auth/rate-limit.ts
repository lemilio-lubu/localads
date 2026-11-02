import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModuleOptions } from "@nestjs/throttler";
import { AuthPrincipal } from "./auth.types";

type ThrottledRequest = { ip?: string; user?: AuthPrincipal; body?: { username?: unknown } };

const minute = 60_000;
const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/* El frontend llama a la API a traves del proxy de Next (`/api/v1`), asi que
   muchas personas pueden llegar con la misma IP. Por eso nada se cuenta solo
   por IP: con sesion cuenta el usuario, y el login cuenta IP y correo juntos.
   Un limite por IP a secas bloquearia a todos a la vez por culpa de uno. */
export function rateLimitOptions(env: NodeJS.ProcessEnv = process.env): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: "default", ttl: minute, limit: positive(env.RATE_LIMIT_PER_MINUTE, 600) }],
    errorMessage: "Demasiadas solicitudes. Espera un momento y vuelve a intentarlo",
  };
}

export const loginRateLimit = (env: NodeJS.ProcessEnv = process.env) => ({
  default: {
    ttl: minute,
    limit: positive(env.LOGIN_RATE_LIMIT_PER_MINUTE, 10),
    getTracker: (request: ThrottledRequest) => {
      const username = typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "";
      return `${request.ip ?? "unknown"}:${username}`;
    },
  },
});

/* Cambiar la clave exige la actual: limitarlo frena adivinarla con una sesion robada. */
export const passwordChangeRateLimit = { default: { ttl: 15 * minute, limit: 5 } };

/* Va despues de JwtAuthGuard para conocer al usuario. El tiempo real no pasa
   por aqui: un socket no tiene peticion HTTP que contar. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== "http";
  }

  protected async getTracker(request: ThrottledRequest): Promise<string> {
    return request.user?.userId ? `user:${request.user.userId}` : `ip:${request.ip ?? "unknown"}`;
  }
}
