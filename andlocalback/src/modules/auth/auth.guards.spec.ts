import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard, RolesGuard } from "./auth.guards";
import { AUTH_ROLES, isAuthRole } from "./auth.types";

const principal = { userId: "user-1", role: "CLIENT" as const, clientId: "client-1", accountId: "account-1" };

function wsContext(client: object) {
  return {
    getType: () => "ws",
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToWs: () => ({ getClient: () => client }),
  } as never;
}

describe("guards de autenticación WebSocket", () => {
  it("reutiliza el principal validado durante el handshake", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const tokens = { verify: vi.fn() };
    const guard = new JwtAuthGuard(reflector as never, tokens as never);

    expect(guard.canActivate(wsContext({ data: { user: principal } }))).toBe(true);
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it("valida el access token del handshake cuando aún no existe principal", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const tokens = { verify: vi.fn().mockReturnValue(principal) };
    const client: { data: { user?: typeof principal }; handshake: { auth: { accessToken: string } } } = { data: {}, handshake: { auth: { accessToken: "token" } } };
    const guard = new JwtAuthGuard(reflector as never, tokens as never);

    expect(guard.canActivate(wsContext(client))).toBe(true);
    expect(client.data).toEqual({ user: principal });
  });

  it("rechaza un socket sin token ni principal", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const guard = new JwtAuthGuard(reflector as never, { verify: vi.fn() } as never);
    expect(() => guard.canActivate(wsContext({ data: {}, handshake: { auth: {} } }))).toThrow(UnauthorizedException);
  });

  it("evalúa roles usando el principal del socket", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(["ADMIN"]) };
    const guard = new RolesGuard(reflector as never);
    expect(() => guard.canActivate(wsContext({ data: { user: principal } }))).toThrow(ForbiddenException);
  });
});

describe("rol de gestor", () => {
  const gestor = { ...principal, role: "GESTOR" as const, clientId: null, accountId: null };

  it("reconoce los tres roles del sistema y ninguno más", () => {
    expect(AUTH_ROLES).toEqual(["CLIENT", "GESTOR", "ADMIN"]);
    expect(isAuthRole("GESTOR")).toBe(true);
    expect(isAuthRole("VENDEDOR")).toBe(false);
  });

  it("un endpoint abierto a ADMIN y GESTOR admite al gestor", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(["ADMIN", "GESTOR"]) };
    expect(new RolesGuard(reflector as never).canActivate(wsContext({ data: { user: gestor } }))).toBe(true);
  });

  /* Hasta que el filtro por cartera exista, los endpoints administrativos
     siguen siendo solo de ADMIN: abrirlos antes daría al gestor la plataforma
     entera. */
  it("un endpoint reservado a ADMIN sigue cerrado al gestor", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(["ADMIN"]) };
    expect(() => new RolesGuard(reflector as never).canActivate(wsContext({ data: { user: gestor } }))).toThrow(ForbiddenException);
  });
});
