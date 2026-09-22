import { describe, expect, it, vi } from "vitest";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../domain/model/domain-status";
import { VerificationStatus } from "../domain/recharge.types";
import { TransactionsGateway } from "./transactions.gateway";

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
  const gateway = new TransactionsGateway({} as never, scope as never);
  if (server) (gateway as unknown as { server: typeof server }).server = server;
  return gateway;
}

describe("TransactionsGateway", () => {
  it("reconecta cada cliente únicamente a sus salas privadas a partir del JWT", () => {
    const join = vi.fn();
    const disconnect = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({
      userId: "user-1", role: "CLIENT", accountId: "account-1",
    }) } as never, noScope as never);

    gateway.handleConnection({ handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect } as never);

    expect(join).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledWith("account:account-1");
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("desconecta tokens inválidos y no permite que un cliente se suscriba como administrador", () => {
    const disconnect = vi.fn();
    const invalid = new TransactionsGateway({ verify: vi.fn(() => { throw new Error("invalid"); }) } as never, noScope as never);
    invalid.handleConnection({ handshake: { auth: {} }, data: {}, join: vi.fn(), disconnect } as never);
    expect(disconnect).toHaveBeenCalledWith(true);

    const response = gatewayWith(noScope).subscribe({
      data: { user: { role: "CLIENT", accountId: "account-1" } }, join: vi.fn(),
    } as never, { scope: "admin" });
    expect(response).toEqual({ event: "transactions:error", data: { message: "No autorizado" } });
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
  it("mete al gestor en su propia sala, nunca en la de administración", () => {
    const join = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({
      userId: "auth-gestor", role: "GESTOR", clientId: null, accountId: null,
    }) } as never, noScope as never);

    gateway.handleConnection({ handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect: vi.fn() } as never);

    expect(join).toHaveBeenCalledExactlyOnceWith("manager:auth-gestor");
    expect(join).not.toHaveBeenCalledWith("transactions:admin");
  });

  it("acepta la suscripción de back-office del gestor", () => {
    const join = vi.fn();
    const response = gatewayWith(noScope).subscribe({
      data: { user: { userId: "auth-gestor", role: "GESTOR" } }, join,
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
    const gateway = new TransactionsGateway({} as never, undefined as never);
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
