import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SkipThrottle, Throttle, ThrottlerException, ThrottlerStorageService } from "@nestjs/throttler";
import { describe, expect, it } from "vitest";
import { assertSafeEnvironment, environmentProblems, isDeployed, trustProxyHops } from "../src/common/config/environment";
import { AccessTokenService } from "../src/modules/auth/access-token.service";
import { SecureFilesController } from "../src/modules/auth/secure-files.controller";
import { RateLimitGuard, loginRateLimit, passwordChangeRateLimit, rateLimitOptions } from "../src/modules/auth/rate-limit";
import type { AuthPrincipal } from "../src/modules/auth/auth.types";

const secret = "s".repeat(40);
const deployed = { NODE_ENV: "production", JWT_ACCESS_SECRET: secret, FRONTEND_ORIGIN: "https://portal.andlocal.ec", DATABASE_URL: "postgresql://u:p@db/x", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };

describe("configuración de un despliegue", () => {
  it("cuenta Railway como despliegue aunque falte NODE_ENV=production", () => {
    expect(isDeployed({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toBe(true);
    expect(isDeployed({ NODE_ENV: "development" })).toBe(false);
    expect(isDeployed({})).toBe(false);
  });

  it("en local no exige nada", () => {
    expect(environmentProblems({})).toEqual([]);
  });

  it("acepta un despliegue completo", () => {
    expect(environmentProblems(deployed)).toEqual([]);
  });

  it("rechaza el secreto de ejemplo, uno corto y un origen inseguro", () => {
    expect(environmentProblems({ ...deployed, JWT_ACCESS_SECRET: "replace-with-at-least-32-random-bytes" })).toHaveLength(1);
    expect(environmentProblems({ ...deployed, JWT_ACCESS_SECRET: "corto" })).toHaveLength(1);
    expect(environmentProblems({ ...deployed, FRONTEND_ORIGIN: "http://portal.andlocal.ec" })).toHaveLength(1);
    expect(environmentProblems({ ...deployed, FRONTEND_ORIGIN: "*" })).toHaveLength(1);
    expect(() => assertSafeEnvironment({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toThrow(/JWT_ACCESS_SECRET[\s\S]*FRONTEND_ORIGIN[\s\S]*DATABASE_URL/);
  });

  it("un staging sin NODE_ENV ya no firma con el secreto de desarrollo", () => {
    const previous = { ...process.env };
    try {
      delete process.env.NODE_ENV; delete process.env.JWT_ACCESS_SECRET; process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      expect(() => new AccessTokenService()).toThrow(/JWT_ACCESS_SECRET/);
    } finally {
      process.env = previous;
    }
  });

  it("confía en un proxy al desplegar y en ninguno en local", () => {
    expect(trustProxyHops(deployed)).toBe(1);
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ ...deployed, TRUST_PROXY_HOPS: "2" })).toBe(2);
  });
});

class FakeAuthController {
  @Throttle(loginRateLimit({ LOGIN_RATE_LIMIT_PER_MINUTE: "3" })) login() { return true; }
  @Throttle(passwordChangeRateLimit) changePassword() { return true; }
  list() { return true; }
  @SkipThrottle() health() { return true; }
}

async function limiter(env: NodeJS.ProcessEnv = {}) {
  const guard = new RateLimitGuard(rateLimitOptions(env), new ThrottlerStorageService(), new Reflector());
  await guard.onModuleInit();
  return guard;
}

function request(handler: keyof FakeAuthController, req: { ip?: string; user?: AuthPrincipal; body?: unknown }, type = "http") {
  const headers: Record<string, unknown> = {};
  const context = {
    getType: () => type,
    getHandler: () => FakeAuthController.prototype[handler],
    getClass: () => FakeAuthController,
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...req }), getResponse: () => ({ header: (name: string, value: unknown) => { headers[name] = value; } }) }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

const user = (userId: string) => ({ userId, username: userId, role: "CLIENT", clientId: "c", accountId: "a", accountType: "PREPAGO" }) as AuthPrincipal;

describe("límite de solicitudes", () => {
  it("bloquea el login tras los intentos permitidos para la misma IP y correo", async () => {
    const guard = await limiter();
    const attempt = (username: string) => guard.canActivate(request("login", { ip: "10.0.0.1", body: { username } }).context);
    for (let index = 0; index < 3; index += 1) await expect(attempt("Admin@andlocal.test ")).resolves.toBe(true);
    await expect(attempt("admin@andlocal.test")).rejects.toBeInstanceOf(ThrottlerException);
    // Otro correo desde la misma IP (todos llegan por el proxy de Next) sigue entrando.
    await expect(attempt("prepago@andlocal.test")).resolves.toBe(true);
  });

  it("con sesión cuenta por usuario, no por IP", async () => {
    const guard = await limiter({ RATE_LIMIT_PER_MINUTE: "2" });
    const call = (userId: string) => guard.canActivate(request("list", { ip: "10.0.0.9", user: user(userId) }).context);
    await call("u1"); await call("u1");
    await expect(call("u1")).rejects.toBeInstanceOf(ThrottlerException);
    await expect(call("u2")).resolves.toBe(true);
  });

  it("limita el cambio de clave a cinco intentos", async () => {
    const guard = await limiter();
    const call = () => guard.canActivate(request("changePassword", { user: user("u1") }).context);
    for (let index = 0; index < 5; index += 1) await call();
    await expect(call()).rejects.toBeInstanceOf(ThrottlerException);
  });

  it("deja pasar el health y el tiempo real", async () => {
    const guard = await limiter({ RATE_LIMIT_PER_MINUTE: "1" });
    for (let index = 0; index < 3; index += 1) {
      await expect(guard.canActivate(request("health", { ip: "10.0.0.2" }).context)).resolves.toBe(true);
      await expect(guard.canActivate(request("list", {}, "ws").context)).resolves.toBe(true);
    }
  });
});

describe("comprobantes", () => {
  it("ya no existe la ruta por nombre de archivo", () => {
    expect(Object.getOwnPropertyNames(SecureFilesController.prototype)).not.toContain("receipt");
  });
});
