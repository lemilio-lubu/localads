import { describe, expect, it, vi } from "vitest";
import { TransactionPaymentStatus, TransactionRechargeStatus } from "../domain/model/domain-status";
import { VerificationStatus } from "../domain/recharge.types";
import { TransactionsGateway } from "./transactions.gateway";

describe("TransactionsGateway", () => {
  it("reconecta cada cliente únicamente a su sala privada a partir del JWT", () => {
    const join = vi.fn();
    const disconnect = vi.fn();
    const gateway = new TransactionsGateway({ verify: vi.fn().mockReturnValue({
      userId: "user-1", role: "CLIENT", accountId: "account-1",
    }) } as never);
    const socket = { handshake: { auth: { accessToken: "jwt" } }, data: {}, join, disconnect };

    gateway.handleConnection(socket as never);

    expect(join).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledWith("account:account-1");
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("desconecta tokens inválidos y no permite que un cliente se suscriba como administrador", () => {
    const disconnect = vi.fn();
    const invalidGateway = new TransactionsGateway({ verify: vi.fn(() => { throw new Error("invalid"); }) } as never);
    invalidGateway.handleConnection({ handshake: { auth: {} }, data: {}, join: vi.fn(), disconnect } as never);
    expect(disconnect).toHaveBeenCalledWith(true);

    const gateway = new TransactionsGateway({} as never);
    const response = gateway.subscribe({
      data: { user: { role: "CLIENT", accountId: "account-1" } }, join: vi.fn(),
    } as never, { scope: "admin" });
    expect(response).toEqual({ event: "transactions:error", data: { message: "No autorizado" } });
  });

  it("publica la verificación en administración y en la cuenta sin exponer accountId", () => {
    const emit = vi.fn();
    const chain = { to: vi.fn(), emit };
    chain.to.mockReturnValue(chain);
    const gateway = new TransactionsGateway({} as never);
    (gateway as unknown as { server: typeof chain }).server = chain;

    gateway.publishVerification({
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
    });

    expect(chain.to).toHaveBeenNthCalledWith(1, "transactions:admin");
    expect(chain.to).toHaveBeenNthCalledWith(2, "account:account-1");
    expect(emit).toHaveBeenCalledWith("verification:changed", {
      eventId: "verification-1:2",
      verificationId: "verification-1",
      transactionId: "transaction-1",
      status: VerificationStatus.UNDER_REVIEW,
      paymentStatus: TransactionPaymentStatus.UNDER_REVIEW,
      rechargeStatus: TransactionRechargeStatus.UNDER_REVIEW,
      reason: "El monto necesita revisión manual",
      version: 2,
      occurredAt: "2026-09-11T15:00:00.000Z",
    });
  });
});
