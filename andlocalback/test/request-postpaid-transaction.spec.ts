import { describe, expect, it } from "vitest";
import { presentPostpaidTransaction } from "../src/modules/recharges/application/multi-recharge.presenter";
import {
  PostpaidRechargeContext,
  PostpaidTransactionPersistencePort,
  PostpaidTransactionRecord,
  PostpaidTransactionView,
} from "../src/modules/recharges/application/ports/postpaid-transaction.ports";
import { MarkOverduePayments } from "../src/modules/recharges/application/use-cases/mark-overdue-payments";
import { RequestPostpaidTransaction } from "../src/modules/recharges/application/use-cases/request-postpaid-transaction";
import { Pauta } from "../src/modules/recharges/domain/entities/pauta";
import {
  PautaStatus,
  TransactionDetailStatus,
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../src/modules/recharges/domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
} from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";

const now = new Date("2026-09-10T15:30:00.000Z");

function pauta(id: string, platform: AdvertisingPlatform, status = PautaStatus.ACTIVE, clientId = "client-1") {
  return new Pauta({
    id,
    clientId,
    platform,
    externalAccountId: `${platform.toLowerCase()}-external`,
    status,
    currentBalance: MonetaryAmount.zero(),
    activatedAt: status === PautaStatus.ACTIVE ? new Date("2026-01-01T00:00:00.000Z") : null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

/* El contexto del puerto es Readonly; los tests lo ajustan caso a caso
   (cuenta sin credito, pautas suspendidas), asi que la fabrica lo devuelve
   mutable. Sigue siendo asignable al tipo del puerto. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function activeContext(): Mutable<PostpaidRechargeContext> {
  return {
    client: { id: "client-1", status: ClientStatus.ACTIVE },
    account: {
      id: "account-1",
      clientId: "client-1",
      status: AccountStatus.ACTIVE,
      type: AccountType.POSTPAID,
      creditDays: 30,
      creditLimit: MonetaryAmount.fromMajorUnits("2000.00"),
      creditUsed: MonetaryAmount.fromMajorUnits("500.00"),
    },
    pautas: [
      pauta("pauta-meta", AdvertisingPlatform.META),
      pauta("pauta-google", AdvertisingPlatform.GOOGLE),
      pauta("pauta-tiktok", AdvertisingPlatform.TIKTOK),
    ],
  };
}

class MemoryPostpaidPersistence implements PostpaidTransactionPersistencePort {
  saved: PostpaidTransactionRecord | null = null;
  existing: PostpaidTransactionView | null = null;
  overdueCalls: Date[] = [];
  markedCount = 0;
  loadCalls = 0;
  findCalls = 0;

  constructor(public context: PostpaidRechargeContext) {}

  async loadPostpaidContext(): Promise<PostpaidRechargeContext> {
    this.loadCalls += 1;
    return this.context;
  }

  async findPostpaidByIdempotencyKey(): Promise<PostpaidTransactionView | null> {
    this.findCalls += 1;
    return this.existing;
  }

  async savePostpaid(record: PostpaidTransactionRecord): Promise<PostpaidTransactionView> {
    this.saved = record;
    return presentPostpaidTransaction(record);
  }

  async markOverduePayments(asOf: Date): Promise<number> {
    this.overdueCalls.push(asOf);
    return this.markedCount;
  }
}

function setup(context = activeContext()) {
  const persistence = new MemoryPostpaidPersistence(context);
  const generated = ["transaction-1", "detail-1", "detail-2", "detail-3", "payment-1"];
  const useCase = new RequestPostpaidTransaction(
    persistence,
    { generate: () => generated.shift() ?? "unexpected-id" },
    () => now,
  );
  return { persistence, useCase };
}

const command = {
  clientId: "client-1",
  accountId: "account-1",
  idempotencyKey: "postpaid-request-1",
  details: [
    { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 500 },
    { platform: AdvertisingPlatform.GOOGLE, amount: 300 },
    { pautaId: "pauta-tiktok", platform: AdvertisingPlatform.TIKTOK, amount: 200 },
  ],
};

describe("RequestPostpaidTransaction", () => {
  it("crea una sola transaccion autorizada, tres detalles y una obligacion en credito", async () => {
    const { useCase, persistence } = setup();

    const result = await useCase.execute(command);

    expect(result).not.toHaveProperty("receipt");
    expect(result).toMatchObject({
      id: "transaction-1",
      code: "TX-transaction-1",
      accountTypeSnapshot: AccountType.POSTPAID,
      status: TransactionRechargeStatus.APPROVED,
      createdAt: now.toISOString(),
      totals: {
        pautaAmount: 1000,
        isdAmount: 50,
        agencyCommissionAmount: 100,
        vatBaseAmount: 1150,
        vatAmount: 172.5,
        totalAmount: 1322.5,
      },
      payment: {
        id: "payment-1",
        status: TransactionPaymentStatus.IN_CREDIT,
        expectedAmount: 1322.5,
        dueDate: "2026-10-10T15:30:00.000Z",
      },
    });
    expect(result.details).toHaveLength(3);
    expect(result.details.every((detail) => detail.status === TransactionDetailStatus.APPROVED)).toBe(true);
    expect(persistence.saved?.transaction.totals.totalAmount.toMajorUnits()).toBe("1322.50");
  });

  it("calcula la fecha de vencimiento desde createdAt con los dias configurados", async () => {
    const context = activeContext();
    context.account = { ...context.account!, creditDays: 5 };
    const { useCase } = setup(context);

    const result = await useCase.execute({
      ...command,
      details: [{ platform: AdvertisingPlatform.META, amount: 100 }],
    });

    expect(result.payment.dueDate).toBe("2026-09-15T15:30:00.000Z");
    expect(result.payment.status).toBe(TransactionPaymentStatus.IN_CREDIT);
  });

  it("reserva conceptualmente el total facturable y rechaza cuando supera el disponible", async () => {
    const context = activeContext();
    context.account = {
      ...context.account!,
      creditLimit: MonetaryAmount.fromMajorUnits("1500.00"),
      creditUsed: MonetaryAmount.fromMajorUnits("200.00"),
    };
    const { useCase, persistence } = setup(context);

    await expect(useCase.execute(command)).rejects.toMatchObject({ code: "CREDIT_INSUFFICIENT" });
    expect(persistence.saved).toBeNull();
  });

  it("permite consumir exactamente todo el credito disponible", async () => {
    const context = activeContext();
    context.account = {
      ...context.account!,
      creditLimit: MonetaryAmount.fromMajorUnits("1822.50"),
      creditUsed: MonetaryAmount.fromMajorUnits("500.00"),
    };
    const { useCase } = setup(context);

    const result = await useCase.execute(command);

    expect(result.totals.totalAmount).toBe(1322.5);
  });

  it("devuelve la operacion existente antes de validar credito o generar ids", async () => {
    const first = setup();
    const existing = await first.useCase.execute(command);
    const exhausted = activeContext();
    exhausted.account = {
      ...exhausted.account!,
      creditLimit: MonetaryAmount.fromMajorUnits("1.00"),
      creditUsed: MonetaryAmount.fromMajorUnits("1.00"),
    };
    const second = setup(exhausted);
    second.persistence.existing = existing;

    const result = await second.useCase.execute(command);

    expect(result).toBe(existing);
    expect(second.persistence.saved).toBeNull();
  });

  it.each([
    ["cliente inexistente", { ...activeContext(), client: null }, "CLIENT_NOT_FOUND"],
    ["cliente inactivo", { ...activeContext(), client: { id: "client-1", status: ClientStatus.INACTIVE } }, "CLIENT_INACTIVE"],
    ["cuenta inexistente", { ...activeContext(), account: null }, "ACCOUNT_NOT_FOUND"],
    ["cuenta ajena", { ...activeContext(), account: { ...activeContext().account!, clientId: "client-2" } }, "INVALID_ACCOUNT_CONTEXT"],
    ["cuenta inactiva", { ...activeContext(), account: { ...activeContext().account!, status: AccountStatus.INACTIVE } }, "ACCOUNT_INACTIVE"],
    ["cuenta prepago", { ...activeContext(), account: { ...activeContext().account!, type: AccountType.PREPAID } }, "ACCOUNT_TYPE_MISMATCH"],
    ["cero dias", { ...activeContext(), account: { ...activeContext().account!, creditDays: 0 } }, "INVALID_CREDIT_DAYS"],
    ["dias fraccionarios", { ...activeContext(), account: { ...activeContext().account!, creditDays: 1.5 } }, "INVALID_CREDIT_DAYS"],
  ])("rechaza %s", async (_name, context, code) => {
    const { useCase, persistence } = setup(context as PostpaidRechargeContext);
    await expect(useCase.execute(command)).rejects.toMatchObject({ code });
    expect(persistence.saved).toBeNull();
  });

  it("valida owner autenticado, detalles, montos, pautas activas y duplicados", async () => {
    const owner = setup();
    await expect(owner.useCase.execute({ ...command, clientId: "client-2" }))
      .rejects.toMatchObject({ code: "ACCOUNT_NOT_OWNED" });

    const empty = setup();
    await expect(empty.useCase.execute({ ...command, details: [] }))
      .rejects.toMatchObject({ code: "TRANSACTION_DETAILS_REQUIRED" });

    const amount = setup();
    await expect(amount.useCase.execute({
      ...command,
      details: [{ platform: AdvertisingPlatform.META, amount: 0 }],
    })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });

    const inactiveContext = activeContext();
    inactiveContext.pautas = [pauta("pauta-meta", AdvertisingPlatform.META, PautaStatus.SUSPENDED)];
    const inactive = setup(inactiveContext);
    await expect(inactive.useCase.execute({
      ...command,
      details: [{ platform: AdvertisingPlatform.META, amount: 10 }],
    })).rejects.toMatchObject({ code: "PAUTA_NOT_ACTIVE" });

    const duplicate = setup();
    await expect(duplicate.useCase.execute({
      ...command,
      details: [
        { platform: AdvertisingPlatform.META, amount: 10 },
        { platform: AdvertisingPlatform.META, amount: 20 },
      ],
    })).rejects.toMatchObject({ code: "DUPLICATE_PAUTA" });
  });
});

describe("MarkOverduePayments", () => {
  it("delega un corte temporal unico y reporta cuantos pagos se vencieron", async () => {
    const persistence = new MemoryPostpaidPersistence(activeContext());
    persistence.markedCount = 3;
    const useCase = new MarkOverduePayments(persistence, () => now);

    const result = await useCase.execute();

    expect(result).toEqual({ markedCount: 3, processedAt: now.toISOString() });
    expect(persistence.overdueCalls).toEqual([now]);
  });

  it("acepta un corte explicito para procesos reproducibles", async () => {
    const persistence = new MemoryPostpaidPersistence(activeContext());
    const useCase = new MarkOverduePayments(persistence, () => now);
    const explicit = new Date("2026-12-01T00:00:00.000Z");

    await useCase.execute(explicit);

    expect(persistence.overdueCalls).toEqual([explicit]);
  });
});
