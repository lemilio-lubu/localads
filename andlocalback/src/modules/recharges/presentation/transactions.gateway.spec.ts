import { describe, expect, it, vi } from "vitest";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../domain/model/domain-status";
import { VerificationStatus } from "../domain/recharge.types";
import { TransactionsGateway } from "./transactions.gateway";

/* La sesion sigue vigente salvo que el test diga otra cosa. */
const liveSessions = { isCurrent: vi.fn().mockResolvedValue(true) };
const future = () => Math.floor(Date.now() / 1000) + 900;

const noScope = { managerOfClient: vi.fn(), managerOfAccount: vi.fn() };
const scopeOf = (managerId: string | null) => ({
  managerOfClient: vi.fn().mockResolvedValue(managerId),
  managerOfAccount: vi.fn().mockResolvedValue(managerId),
});

const verificationEvent = {
  eventId: "verification-1:2",
  verificationId: "verification-1",
  transactionId: "transaction-1",
  accountId: "account-1",
  status: VerificationStatus.UNDER_REVIEW,
  paymentStatus: TransactionPaymentStatus.UNDER_REVIEW,
  rechargeStatus: TransactionRechargeStatus.UNDER_REVIEW,
  reason: "El monto necesita revisión manual",
  version: 2,
  occurredAt: "2026-09-11T15:00:00.000Z",
} as const;

const { accountId: _omitted, ...verificationPayload } = verificationEvent;

function serverDouble() {
  const emit = vi.fn();
  const chain = { to: vi.fn(), emit };
  chain.to.mockReturnValue(chain);
  return chain;
}

function gatewayWith(scope: object, server?: ReturnType<typeof serverDouble>) {
  const gateway = new TransactionsGateway({} as never, scope as never, liveSessions as never);
  if (server) (gateway as unknown as { server: typeof server }).server = server;
  return gateway;
}

describe("TransactionsGateway", () => {
  it("reconecta cada cliente únicamente a sus salas privadas a partir del JWT", async () => {
    const join = vi.fn();
    const disconnect = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({
      userId: "user-1", role: "CLIENT", accountId: "account-1", exp: future(),
    }) } as never, noScope as never, liveSessions as never);

    await gateway.handleConnection({ handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect } as never);

    expect(join).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledWith("account:account-1");
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("desconecta tokens inválidos y no permite que un cliente se suscriba como administrador", async () => {
    const disconnect = vi.fn();
    const invalid = new TransactionsGateway({ verify: vi.fn(() => { throw new Error("invalid"); }) } as never, noScope as never, liveSessions as never);
    await invalid.handleConnection({ handshake: { auth: {} }, data: {}, join: vi.fn(), disconnect } as never);
    expect(disconnect).toHaveBeenCalledWith(true);

    const response = gatewayWith(noScope).subscribe({
      data: { user: { role: "CLIENT", accountId: "account-1", exp: future() } }, join: vi.fn(),
    } as never, { scope: "admin" });
    expect(response).toEqual({ event: "transactions:error", data: { message: "No autorizado" } });
  });

  it("rechaza el socket de una sesión que ya no vale (baja, rol o clave cambiados)", async () => {
    const join = vi.fn(); const disconnect = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({ userId: "user-1", role: "CLIENT", accountId: "account-1", exp: future() }) } as never, noScope as never, { isCurrent: vi.fn().mockResolvedValue(false) } as never);
    await gateway.handleConnection({ handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect } as never);
    expect(join).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it("corta el socket al vencer el token y rechaza suscribirse con uno vencido", async () => {
    vi.useFakeTimers();
    try {
      const disconnect = vi.fn();
      const exp = Math.floor(Date.now() / 1000) + 30;
      const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({ userId: "user-1", role: "CLIENT", accountId: "account-1", exp }) } as never, noScope as never, liveSessions as never);
      const client = { handshake: { auth: { accessToken: "jwt" } }, data: {} as Record<string, unknown>, join: vi.fn(), disconnect, connected: true };
      await gateway.handleConnection(client as never);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(disconnect).toHaveBeenCalledWith(true);
      expect(gateway.subscribe(client as never, {})).toEqual({ event: "transactions:error", data: { message: "No autorizado" } });
    } finally { vi.useRealTimers(); }
  });

  it("publica la verificación en administración y en la cuenta sin exponer accountId", () => {
    const server = serverDouble();
    gatewayWith(scopeOf(null), server).publishVerification(verificationEvent);

    expect(server.to).toHaveBeenNthCalledWith(1, "transactions:admin");
    expect(server.to).toHaveBeenNthCalledWith(2, "account:account-1");
    expect(server.emit).toHaveBeenCalledWith("verification:changed", verificationPayload);
  });
});

/* El gestor quedaba fuera del gateway: no entraba en ninguna sala y su
   `subscribe` respondia error, asi que su pantalla no se refrescaba sola.
   Meterlo en `transactions:admin` habria sido la fuga contraria, porque por
   ahi pasan los eventos de toda la cartera. */
describe("TransactionsGateway · alcance del gestor", () => {
  it("mete al gestor en su propia sala, nunca en la de administración", async () => {
    const join = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({
      userId: "auth-gestor", role: "GESTOR", clientId: null, accountId: null, exp: future(),
    }) } as never, noScope as never, liveSessions as never);

    await gateway.handleConnection({ handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect: vi.fn() } as never);

    expect(join).toHaveBeenCalledExactlyOnceWith("manager:auth-gestor");
    expect(join).not.toHaveBeenCalledWith("transactions:admin");
  });

  it("acepta la suscripción de back-office del gestor", () => {
    const join = vi.fn();
    const response = gatewayWith(noScope).subscribe({
      data: { user: { userId: "auth-gestor", role: "GESTOR", exp: future() } }, join,
    } as never, { scope: "admin" });

    expect(response).toEqual({ event: "transactions:subscribed", data: { connected: true } });
    expect(join).toHaveBeenCalledWith("manager:auth-gestor");
  });

  it("enruta la verificación al gestor dueño de la cuenta", async () => {
    const server = serverDouble();
    const scope = scopeOf("auth-gestor");
    gatewayWith(scope, server).publishVerification(verificationEvent);
    await vi.waitFor(() => expect(server.to).toHaveBeenCalledWith("manager:auth-gestor"));

    expect(scope.managerOfAccount).toHaveBeenCalledWith("account-1");
    expect(server.emit).toHaveBeenCalledWith("verification:changed", verificationPayload);
  });

  it("no emite a ninguna sala de gestor cuando el cliente es huérfano", async () => {
    const server = serverDouble();
    gatewayWith(scopeOf(null), server).publishPlatforms("client-huerfano");
    await vi.waitFor(() => expect(server.emit).toHaveBeenCalled());

    expect(server.to).not.toHaveBeenCalledWith(expect.stringContaining("manager:"));
  });

  /* Una dependencia sin inyectar revienta de forma sincrona, y un `.catch`
     encadenado a la llamada no llega a verlo. Lo detecto un test de fase 11
     que construia el gateway sin el puerto. */
  it("una consulta que revienta de forma síncrona tampoco tumba el evento", async () => {
    const server = serverDouble();
    const gateway = new TransactionsGateway({} as never, undefined as never, liveSessions as never);
    (gateway as unknown as { server: typeof server }).server = server;

    expect(() => gateway.publishPlatforms("client-001")).not.toThrow();
    await vi.waitFor(() => expect(server.emit).toHaveBeenCalledWith("platforms:changed", { clientId: "client-001" }));
  });

  it("una consulta fallida no tumba el evento de los demás", async () => {
    const server = serverDouble();
    const scope = { managerOfClient: vi.fn().mockRejectedValue(new Error("base caida")), managerOfAccount: vi.fn() };
    expect(() => gatewayWith(scope, server).publishPlatforms("client-001")).not.toThrow();
    await vi.waitFor(() => expect(server.emit).toHaveBeenCalledWith("platforms:changed", { clientId: "client-001" }));
  });
});
