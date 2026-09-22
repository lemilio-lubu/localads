import { ApplicationError } from "../src/common/errors/application.error";
import { CompleteTransactionDetail } from "../src/modules/recharges/application/use-cases/complete-transaction-detail";
import { CompleteTransaction } from "../src/modules/recharges/application/use-cases/complete-transaction";
import { StartTransactionRecharge } from "../src/modules/recharges/application/use-cases/start-transaction-recharge";
import {
  CompletedTransactionView,
  TransactionExecutionContext,
  TransactionExecutionPersistencePort,
  TransactionExecutionView,
} from "../src/modules/recharges/application/ports/transaction-execution.ports";
import {
  InvoiceStatus,
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../src/modules/recharges/domain/model/domain-status";
import { AccountType } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { Pauta } from "../src/modules/recharges/domain/entities/pauta";
import { AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { describe, expect, it, vi } from "vitest";

const at = new Date("2026-09-10T12:00:00.000Z");
const effectiveAt = new Date("2026-09-10T11:55:00.000Z");

function context(overrides: Partial<TransactionExecutionContext> = {}): TransactionExecutionContext {
  return {
    id: "tx-1",
    code: "TX-1",
    accountTypeSnapshot: AccountType.PREPAID,
    status: TransactionRechargeStatus.APPROVED,
    version: 2,
    paymentStatus: TransactionPaymentStatus.PAID,
    completedAt: null,
    invoice: null,
    totals: {
      pautaAmount: MonetaryAmount.fromMajorUnits(100),
      isdAmount: MonetaryAmount.fromMajorUnits(5),
      agencyCommissionAmount: MonetaryAmount.fromMajorUnits(10),
      vatBaseAmount: MonetaryAmount.fromMajorUnits(115),
      vatAmount: MonetaryAmount.fromMajorUnits(17.25),
      totalAmount: MonetaryAmount.fromMajorUnits(132.25),
    },
    details: [{
      id: "detail-1",
      pautaId: "pauta-1",
      pautaStatus: PautaStatus.ACTIVE,
      status: TransactionDetailStatus.APPROVED,
      requestedAmount: MonetaryAmount.fromMajorUnits(100),
      effectiveAmount: null,
      effectiveRechargeDate: null,
    }],
    ...overrides,
  };
}

function executionView(status: TransactionRechargeStatus): TransactionExecutionView {
  return {
    transactionId: "tx-1",
    code: "TX-1",
    status,
    completedAt: status === TransactionRechargeStatus.COMPLETED ? at.toISOString() : null,
    details: [],
  };
}

function persistence(loaded: TransactionExecutionContext): TransactionExecutionPersistencePort {
  return {
    loadExecutionContext: vi.fn().mockResolvedValue(loaded),
    startTransaction: vi.fn().mockResolvedValue(executionView(TransactionRechargeStatus.PROCESSING)),
    completeTransactionDetail: vi.fn().mockResolvedValue({
      transactionId: "tx-1",
      detailId: "detail-1",
      pautaId: "pauta-1",
      status: TransactionDetailStatus.COMPLETED,
      effectiveAmount: 95,
      effectiveRechargeDate: effectiveAt.toISOString(),
      pautaBalance: 195,
    }),
    finalizeTransactionAndIssueInvoice: vi.fn().mockResolvedValue({
      transaction: executionView(TransactionRechargeStatus.COMPLETED),
      invoice: {
        id: "invoice-1",
        transactionId: "tx-1",
        number: "FAC-TX-1",
        status: InvoiceStatus.ISSUED,
        issuedAt: at.toISOString(),
        pautaAmount: 100,
        isdAmount: 5,
        agencyCommissionAmount: 10,
        vatBaseAmount: 115,
        vatAmount: 17.25,
        totalAmount: 132.25,
      },
    } satisfies CompletedTransactionView),
  };
}

describe("Phase 5 transaction execution", () => {
  it("starts an approved prepaid transaction only after payment confirmation", async () => {
    const repo = persistence(context());
    const result = await new StartTransactionRecharge(repo, () => at).execute({ transactionId: "tx-1" });
    expect(result.status).toBe(TransactionRechargeStatus.PROCESSING);
    expect(repo.startTransaction).toHaveBeenCalledWith("tx-1", 2, at);
  });

  it.each([
    TransactionPaymentStatus.IN_CREDIT,
    TransactionPaymentStatus.OVERDUE,
    TransactionPaymentStatus.UNDER_REVIEW,
    TransactionPaymentStatus.PAID,
  ])("allows a postpaid transaction with payment status %s", async (paymentStatus) => {
    const repo = persistence(context({ accountTypeSnapshot: AccountType.POSTPAID, paymentStatus }));
    await new StartTransactionRecharge(repo, () => at).execute({ transactionId: "tx-1" });
    expect(repo.startTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not start when one pauta is no longer active", async () => {
    const base = context();
    const repo = persistence(context({ details: [{ ...base.details[0], pautaStatus: PautaStatus.SUSPENDED }] }));
    await expect(new StartTransactionRecharge(repo).execute({ transactionId: "tx-1" }))
      .rejects.toMatchObject<ApplicationError>({ code: "PAUTA_NOT_ACTIVE" });
  });

  it("rejects reprocessing a completed transaction", async () => {
    const repo = persistence(context({ status: TransactionRechargeStatus.COMPLETED }));
    await expect(new StartTransactionRecharge(repo).execute({ transactionId: "tx-1" }))
      .rejects.toMatchObject<ApplicationError>({ code: "TRANSACTION_ALREADY_COMPLETED" });
  });

  it("completes a detail with its effective amount", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{ ...base.details[0], status: TransactionDetailStatus.PROCESSING }],
    }));
    const result = await new CompleteTransactionDetail(repo, () => at).execute({
      transactionId: "tx-1",
      detailId: "detail-1",
      executedBy: "auth-admin",
      mayDeviate: true,
      effectiveAmount: 95,
      effectiveRechargeDate: effectiveAt,
    });
    expect(result.pautaBalance).toBe(195);
    expect(repo.completeTransactionDetail).toHaveBeenCalledWith(expect.objectContaining({
      effectiveAmount: MonetaryAmount.fromMajorUnits(95),
      effectiveRechargeDate: effectiveAt,
    }));
  });

  it("accepts an idempotent detail retry by effective amount and rejects a different amount", async () => {
    const base = context();
    const completed = context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{
        ...base.details[0],
        status: TransactionDetailStatus.COMPLETED,
        effectiveAmount: MonetaryAmount.fromMajorUnits(95),
        effectiveRechargeDate: effectiveAt,
      }],
    });
    const repo = persistence(completed);
    await new CompleteTransactionDetail(repo).execute({
      transactionId: "tx-1", detailId: "detail-1", executedBy: "auth-admin", mayDeviate: true, effectiveAmount: 95, effectiveRechargeDate: new Date(),
    });
    await expect(new CompleteTransactionDetail(repo).execute({
      transactionId: "tx-1", detailId: "detail-1", executedBy: "auth-admin", mayDeviate: true, effectiveAmount: 96, effectiveRechargeDate: effectiveAt,
    })).rejects.toMatchObject<ApplicationError>({ code: "TRANSACTION_DETAIL_ALREADY_COMPLETED" });
  });

  it("accepts the same detail retry after the whole transaction was completed", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.COMPLETED,
      completedAt: at,
      details: [{
        ...base.details[0],
        status: TransactionDetailStatus.COMPLETED,
        effectiveAmount: MonetaryAmount.fromMajorUnits(95),
        effectiveRechargeDate: effectiveAt,
      }],
    }));
    const result = await new CompleteTransactionDetail(repo).execute({
      transactionId: "tx-1",
      detailId: "detail-1",
      executedBy: "auth-admin",
      mayDeviate: true,
      effectiveAmount: 95,
      effectiveRechargeDate: new Date("2026-09-11T00:00:00.000Z"),
    });
    expect(result.effectiveAmount).toBe(95);
    expect(repo.completeTransactionDetail).toHaveBeenCalledTimes(1);
  });

  it("finalizes and issues one invoice only after every detail is completed", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{
        ...base.details[0],
        status: TransactionDetailStatus.COMPLETED,
        effectiveAmount: MonetaryAmount.fromMajorUnits(95),
        effectiveRechargeDate: effectiveAt,
      }],
    }));
    const ids = { generate: vi.fn().mockReturnValue("invoice-1") };
    const result = await new CompleteTransaction(repo, ids, () => at).execute({ transactionId: "tx-1" });
    expect(result.invoice.totalAmount).toBe(132.25);
    expect(repo.finalizeTransactionAndIssueInvoice).toHaveBeenCalledWith({
      transactionId: "tx-1",
      expectedVersion: 2,
      invoiceId: "invoice-1",
      completedAt: at,
    });
  });

  it("returns the persisted invoice when finalization is retried", async () => {
    const base = context();
    const invoice = {
      id: "invoice-1",
      transactionId: "tx-1",
      number: "FAC-TX-1",
      status: InvoiceStatus.ISSUED,
      issuedAt: at.toISOString(),
      pautaAmount: 100,
      isdAmount: 5,
      agencyCommissionAmount: 10,
      vatBaseAmount: 115,
      vatAmount: 17.25,
      totalAmount: 132.25,
    } as const;
    const repo = persistence(context({
      status: TransactionRechargeStatus.COMPLETED,
      completedAt: at,
      invoice,
      details: [{
        ...base.details[0],
        status: TransactionDetailStatus.COMPLETED,
        effectiveAmount: MonetaryAmount.fromMajorUnits(95),
        effectiveRechargeDate: effectiveAt,
      }],
    }));
    const result = await new CompleteTransaction(repo, { generate: vi.fn() }).execute({ transactionId: "tx-1" });
    expect(result.invoice).toEqual(invoice);
    expect(repo.finalizeTransactionAndIssueInvoice).not.toHaveBeenCalled();
  });

  it("does not finalize while any detail is incomplete", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{ ...base.details[0], status: TransactionDetailStatus.PROCESSING }],
    }));
    await expect(new CompleteTransaction(repo, { generate: vi.fn() }).execute({ transactionId: "tx-1" }))
      .rejects.toMatchObject<ApplicationError>({ code: "INCOMPLETE_TRANSACTION_DETAILS" });
    expect(repo.finalizeTransactionAndIssueInvoice).not.toHaveBeenCalled();
  });

  it("records an already effective recharge even if the pauta was suspended afterwards", () => {
    const pauta = new Pauta({
      id: "pauta-1",
      clientId: "client-1",
      platform: AdvertisingPlatform.META,
      externalAccountId: null,
      status: PautaStatus.SUSPENDED,
      currentBalance: MonetaryAmount.fromMajorUnits(100),
      activatedAt: at,
      createdAt: at,
    });
    pauta.recordCompletedRecharge("detail-1", MonetaryAmount.fromMajorUnits(95));
    pauta.recordCompletedRecharge("detail-1", MonetaryAmount.fromMajorUnits(95));
    expect(pauta.currentBalance.toSafeNumber()).toBe(195);
  });

  /* Acreditar saldo distinto al solicitado es de administrador. El gestor
     ejecuta la recarga de su cartera, pero teclear el numero que se le abona a
     su propio cliente seria el mismo conflicto que confirmarle el cobro, un
     paso mas adelante y sin un si/no de por medio. */
  it("un gestor no puede acreditar un importe distinto al solicitado", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{ ...base.details[0], status: TransactionDetailStatus.PROCESSING }],
    }));

    await expect(new CompleteTransactionDetail(repo, () => at).execute({
      transactionId: "tx-1", detailId: "detail-1", executedBy: "auth-gestor",
      effectiveAmount: 95, effectiveRechargeDate: effectiveAt,
    })).rejects.toMatchObject<ApplicationError>({ code: "EFFECTIVE_AMOUNT_DEVIATION_NOT_ALLOWED", status: 403 });

    expect(repo.completeTransactionDetail).not.toHaveBeenCalled();
  });

  /* Lo rutinario no se toca: el 100% de lo ejecutado hasta hoy coincide con lo
     solicitado, asi que el gestor sigue completando sin friccion. */
  it("un gestor completa con normalidad cuando el importe coincide", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{ ...base.details[0], status: TransactionDetailStatus.PROCESSING }],
    }));

    await expect(new CompleteTransactionDetail(repo, () => at).execute({
      transactionId: "tx-1", detailId: "detail-1", executedBy: "auth-gestor",
      effectiveAmount: 100, effectiveRechargeDate: effectiveAt,
    })).resolves.toBeDefined();
  });

  /* El movimiento de saldo es el unico sitio donde el dinero se vuelve credito
     y no guardaba autor. */
  it("deja escrito quien movio el saldo", async () => {
    const base = context();
    const repo = persistence(context({
      status: TransactionRechargeStatus.PROCESSING,
      details: [{ ...base.details[0], status: TransactionDetailStatus.PROCESSING }],
    }));

    await new CompleteTransactionDetail(repo, () => at).execute({
      transactionId: "tx-1", detailId: "detail-1", executedBy: "auth-gestor",
      effectiveAmount: 100, effectiveRechargeDate: effectiveAt,
    });

    expect(repo.completeTransactionDetail).toHaveBeenCalledWith(expect.objectContaining({ executedBy: "auth-gestor" }));
  });
});
