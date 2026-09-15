import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard, RolesGuard } from "./auth.guards";

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
