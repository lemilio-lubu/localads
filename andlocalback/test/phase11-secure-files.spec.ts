import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SecureFilesController } from "../src/modules/auth/secure-files.controller";
import type { AuthPrincipal } from "../src/modules/auth/auth.types";
import { TransactionsGateway } from "../src/modules/recharges/presentation/transactions.gateway";
import { VerificationStatus } from "../src/modules/recharges/domain/recharge.types";

const admin: AuthPrincipal = { userId: "admin-1", username: "admin", role: "ADMIN", clientId: null, accountId: null, accountType: null };
const client = (clientId: string): AuthPrincipal => ({ userId: `user-${clientId}`, username: clientId, role: "CLIENT", clientId, accountId: "account-1", accountType: "PREPAGO" });

describe("SecureFilesController fase 11", () => {
  function setup(mimeType = "image/png") {
    const database = { paymentReceipt: { findUnique: vi.fn().mockResolvedValue({
      originalName: "transferencia cliente.png", mimeType, url: "/uploads/receipts/receipt-1.png",
      payment: { transaction: { clientId: "client-1" } },
    }) } };
    const response = { type: vi.fn(), set: vi.fn(), sendFile: vi.fn().mockReturnValue("sent") };
    return { controller: new SecureFilesController(database as never), database, response };
  }

  it("sirve evidencia por receiptId con headers privados e inline", async () => {
    const { controller, response } = setup();
    await expect(controller.receiptContent("receipt-1", admin, response as never)).resolves.toBe("sent");
    expect(response.type).toHaveBeenCalledWith("image/png");
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store, max-age=0",
    }));
    expect(response.sendFile).toHaveBeenCalledWith("receipt-1.png", expect.objectContaining({ root: expect.stringContaining("uploads") }));
  });

  it("permite al propietario y bloquea a otro cliente", async () => {
    const own = setup();
    await expect(own.controller.receiptContent("receipt-1", client("client-1"), own.response as never)).resolves.toBe("sent");
    const other = setup();
    await expect(other.controller.receiptContent("receipt-1", client("client-2"), other.response as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rechaza formatos no permitidos aunque existan en base", async () => {
    const { controller, response } = setup("text/html");
    await expect(controller.receiptContent("receipt-1", admin, response as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("eventos de verificaciones fase 11", () => {
  it("publica la decision para administradores y para la cuenta propietaria", () => {
    const emit = vi.fn();
    const transport = { to: vi.fn(), emit };
    transport.to.mockReturnValue(transport);
    const gateway = new TransactionsGateway({} as never, { managerOfAccount: async () => null } as never);
    (gateway as unknown as { server: typeof transport }).server = transport;

    gateway.publishVerification({
      verificationId: "verification-1", transactionId: "transaction-1", accountId: "account-1",
      status: VerificationStatus.APPROVED, paymentStatus: "PAID", decidedAt: "2026-09-11T12:00:00.000Z",
    });

    expect(transport.to).toHaveBeenNthCalledWith(1, "transactions:admin");
    expect(transport.to).toHaveBeenNthCalledWith(2, "account:account-1");
    expect(emit).toHaveBeenCalledWith("verification:changed", expect.objectContaining({ verificationId: "verification-1" }));
  });
});
