import { describe, expect, it, vi } from "vitest";
import { GetAdminTransactionDetail } from "../src/modules/recharges/application/use-cases/get-admin-transaction-detail";
import { GetMyPautas } from "../src/modules/recharges/application/use-cases/get-my-pautas";
import { GetMyTransactionDetail } from "../src/modules/recharges/application/use-cases/get-my-transaction-detail";
import { GetMyTransactions } from "../src/modules/recharges/application/use-cases/get-my-transactions";
import { GetWalletOverview } from "../src/modules/recharges/application/use-cases/get-wallet-overview";
import { ListAdminTransactions } from "../src/modules/recharges/application/use-cases/list-admin-transactions";
import { ListVerifications } from "../src/modules/recharges/application/use-cases/list-verifications";
import {
  AdminTransactionDetailView,
  ClientTransactionDetailView,
  PageResult,
  Phase7QueryPort,
  TransactionListItemView,
} from "../src/modules/recharges/application/ports/phase7-query.ports";
import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";

const pautas = [
  { id: "p1", platform: AdvertisingPlatform.META, externalAccountId: "meta", status: PautaStatus.ACTIVE, currentBalance: 0.1, activatedAt: null, lastRechargeAt: null },
  { id: "p2", platform: AdvertisingPlatform.GOOGLE, externalAccountId: null, status: PautaStatus.INACTIVE, currentBalance: 0.2, activatedAt: null, lastRechargeAt: null },
  { id: "p3", platform: AdvertisingPlatform.TIKTOK, externalAccountId: null, status: PautaStatus.SUSPENDED, currentBalance: 100, activatedAt: null, lastRechargeAt: null },
] as const;

const listItem: TransactionListItemView = {
  id: "tx1", code: "TX-1", clientId: "c1", clientName: "Cliente", accountId: "a1",
  accountTypeSnapshot: AccountType.PREPAID, rechargeStatus: TransactionRechargeStatus.COMPLETED,
  paymentStatus: TransactionPaymentStatus.PAID, pautaAmount: 100, totalAmount: 132.25,
  platforms: [AdvertisingPlatform.META], dueDate: null, createdAt: "2026-09-10T00:00:00.000Z",
};

const detail: ClientTransactionDetailView = {
  id: "tx1", code: "TX-1", clientId: "c1", accountId: "a1", accountTypeSnapshot: AccountType.PREPAID,
  creditDaysSnapshot: null, rechargeStatus: TransactionRechargeStatus.COMPLETED, pautaAmount: 100,
  isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25, totalAmount: 132.25,
  completedAt: "2026-09-10T01:00:00.000Z", createdAt: "2026-09-10T00:00:00.000Z",
  details: [{ id: "d1", pautaId: "p1", platform: AdvertisingPlatform.META, externalAccountId: "meta",
    requestedAmount: 100, isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25,
    totalAmount: 132.25, effectiveRechargeAmount: 100, status: TransactionDetailStatus.COMPLETED,
    effectiveRechargeDate: "2026-09-10T01:00:00.000Z", completedAt: "2026-09-10T01:00:00.000Z" }],
  payment: { id: "pay1", status: TransactionPaymentStatus.PAID, expectedAmount: 132.25, confirmedAmount: 132.25,
    dueDate: null, confirmedAt: "2026-09-10T00:30:00.000Z", createdAt: "2026-09-10T00:00:00.000Z",
    receipts: [{ id: "r1", originalName: "receipt.png", mimeType: "image/png", size: 10, url: "/r1",
      status: "PROCESSED", createdAt: "2026-09-10T00:00:00.000Z" }] },
  invoice: { id: "i1", invoiceNumber: "F-1", status: InvoiceStatus.ISSUED, issuedAt: "2026-09-10T01:00:00.000Z",
    pautaSubtotal: 100, isdAmount: 5, agencyFeeAmount: 10, vatBaseAmount: 115, vatAmount: 17.25,
    totalAmount: 132.25, documentUrl: null },
  verification: { status: VerificationStatus.UNDER_REVIEW, reviewReason: "Validar referencia", updatedAt: "2026-09-10T00:15:00.000Z" },
};

const page: PageResult<TransactionListItemView> = { items: [listItem], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };
const adminDetail: AdminTransactionDetailView = { ...detail, clientName: "Cliente", verifications: [] };

function port(overrides: Partial<Phase7QueryPort> = {}): Phase7QueryPort {
  return {
    listPautasByClient: vi.fn().mockResolvedValue(pautas),
    listTransactionsByClient: vi.fn().mockResolvedValue(page),
    findTransactionDetailByClient: vi.fn().mockResolvedValue(detail),
    listTransactions: vi.fn().mockResolvedValue(page),
    findTransactionDetail: vi.fn().mockResolvedValue(adminDetail),
    listVerifications: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 }),
    ...overrides,
  };
}

describe("Fase 7 - consultas de aplicacion", () => {
  it("obtiene todas las pautas propias, incluso inactivas y suspendidas", async () => {
    const repository = port();
    const result = await new GetMyPautas(repository).execute({ clientId: " c1 " });
    expect(result.map((item) => item.status)).toEqual([PautaStatus.ACTIVE, PautaStatus.INACTIVE, PautaStatus.SUSPENDED]);
    expect(repository.listPautasByClient).toHaveBeenCalledWith("c1");
  });

  it("proyecta billetera sin entidad Wallet y suma en centavos sin deriva decimal", async () => {
    const result = await new GetWalletOverview(port()).execute({ clientId: "c1" });
    expect(result.balanceTotal).toBe(100.3);
    expect(result.pautas).toHaveLength(3);
  });

  it("pagina exclusivamente las transacciones del cliente", async () => {
    const repository = port();
    await new GetMyTransactions(repository).execute({ clientId: "c1", page: 2, pageSize: 10 });
    expect(repository.listTransactionsByClient).toHaveBeenCalledWith({ clientId: "c1", page: 2, pageSize: 10 });
  });

  it("consulta detalle usando transactionId y clientId en una unica operacion scoped", async () => {
    const repository = port();
    const result = await new GetMyTransactionDetail(repository).execute({ clientId: "c1", transactionId: "tx1" });
    expect(result).toBe(detail);
    expect(repository.findTransactionDetailByClient).toHaveBeenCalledTimes(1);
    expect(repository.findTransactionDetailByClient).toHaveBeenCalledWith({ clientId: "c1", transactionId: "tx1" });
    expect(repository.findTransactionDetail).not.toHaveBeenCalled();
  });

  it("responde igual para transaccion inexistente o ajena sin hacer consulta global", async () => {
    const repository = port({ findTransactionDetailByClient: vi.fn().mockResolvedValue(null) });
    await expect(new GetMyTransactionDetail(repository).execute({ clientId: "intruso", transactionId: "tx1" }))
      .rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND", status: 404 });
    expect(repository.findTransactionDetail).not.toHaveBeenCalled();
  });

  it("detalle de cliente contiene pago, factura y resumen seguro de verificacion", async () => {
    const result = await new GetMyTransactionDetail(port()).execute({ clientId: "c1", transactionId: "tx1" });
    expect(result.payment?.receipts).toHaveLength(1);
    expect(result.invoice?.invoiceNumber).toBe("F-1");
    expect(result.verification).toEqual({
      status: VerificationStatus.UNDER_REVIEW,
      reviewReason: "Validar referencia",
      updatedAt: "2026-09-10T00:15:00.000Z",
    });
    expect(result).not.toHaveProperty("verifications");
    expect(result.payment?.receipts[0]).not.toHaveProperty("checksum");
  });

  it("admin filtra transacciones y conserva monto de pauta y total diferenciados", async () => {
    const repository = port();
    const result = await new ListAdminTransactions(repository).execute({
      clientId: " c1 ", accountType: AccountType.PREPAID, paymentStatus: TransactionPaymentStatus.PAID,
      dateFrom: "2026-09-01", dateTo: "2026-09-30", pageSize: 10,
    });
    expect(result.items[0]).toMatchObject({ pautaAmount: 100, totalAmount: 132.25 });
    expect(repository.listTransactions).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "c1", accountType: AccountType.PREPAID, paymentStatus: TransactionPaymentStatus.PAID, page: 1, pageSize: 10,
    }));
  });

  it("admin obtiene detalle ampliado", async () => {
    expect(await new GetAdminTransactionDetail(port()).execute({ transactionId: "tx1" })).toBe(adminDetail);
  });

  it("lista verificaciones pendientes con filtros normalizados", async () => {
    const repository = port();
    await new ListVerifications(repository).execute({
      status: VerificationStatus.UNDER_REVIEW, clientId: " c1 ", bank: " Pichincha ", page: 2, pageSize: 5,
    });
    expect(repository.listVerifications).toHaveBeenCalledWith(expect.objectContaining({
      status: VerificationStatus.UNDER_REVIEW, clientId: "c1", bank: "Pichincha", page: 2, pageSize: 5,
    }));
  });

  it.each([
    [() => new GetMyTransactions(port()).execute({ clientId: "c1", page: 0 }), "INVALID_PAGE"],
    [() => new GetMyTransactions(port()).execute({ clientId: "c1", pageSize: 101 }), "INVALID_PAGE_SIZE"],
    [() => new ListAdminTransactions(port()).execute({ dateFrom: "2026-10-01", dateTo: "2026-09-01" }), "INVALID_DATE_RANGE"],
  ])("valida paginacion y rango de fechas", async (execute, code) => {
    await expect(Promise.resolve().then(execute)).rejects.toMatchObject({ code });
  });
});
