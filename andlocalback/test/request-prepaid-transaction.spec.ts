import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import {
  MultiRechargeContext,
  MultiRechargePersistencePort,
  PrepaidTransactionRecord,
  PrepaidTransactionView,
} from "../src/modules/recharges/application/ports/multi-recharge.ports";
import { RequestPrepaidTransaction } from "../src/modules/recharges/application/use-cases/request-prepaid-transaction";
import { presentPrepaidTransaction } from "../src/modules/recharges/application/multi-recharge.presenter";
import { Pauta } from "../src/modules/recharges/domain/entities/pauta";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { PautaStatus, TransactionPaymentStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import {
  AccountStatus,
  AccountType,
  AdvertisingPlatform,
  ClientStatus,
  ReceiptUpload,
  StoredReceipt,
} from "../src/modules/recharges/domain/recharge.types";

const upload: ReceiptUpload = {
  originalName: "transferencia.png",
  mimeType: "image/png",
  size: 4,
  buffer: Buffer.from("test"),
};

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

class MemoryPersistence implements MultiRechargePersistencePort {
  saved: PrepaidTransactionRecord | null = null;
  existing: PrepaidTransactionView | null = null;
  loadCalls = 0;
  findCalls = 0;

  constructor(public context: MultiRechargeContext) {}

  async loadContext(): Promise<MultiRechargeContext> {
    this.loadCalls += 1;
    return this.context;
  }

  async findByIdempotencyKey(): Promise<PrepaidTransactionView | null> {
    this.findCalls += 1;
    return this.existing;
  }

  async savePrepaid(record: PrepaidTransactionRecord): Promise<PrepaidTransactionView> {
    this.saved = record;
    return presentPrepaidTransaction(record);
  }
}

/* El contexto del puerto es Readonly; los tests lo ajustan caso a caso
   (cuenta sin credito, pautas suspendidas), asi que la fabrica lo devuelve
   mutable. Sigue siendo asignable al tipo del puerto. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function activeContext(): Mutable<MultiRechargeContext> {
  return {
    client: { id: "client-1", status: ClientStatus.ACTIVE },
    account: { id: "account-1", clientId: "client-1", status: AccountStatus.ACTIVE, type: AccountType.PREPAID },
    pautas: [
      pauta("pauta-meta", AdvertisingPlatform.META),
      pauta("pauta-google", AdvertisingPlatform.GOOGLE),
      pauta("pauta-tiktok", AdvertisingPlatform.TIKTOK),
    ],
  };
}

function setup(context = activeContext()) {
  const persistence = new MemoryPersistence(context);
  const storedReceipt: StoredReceipt = {
    id: "receipt-1", originalName: upload.originalName, mimeType: upload.mimeType,
    size: upload.size, url: "/receipts/receipt-1", checksum: "checksum-1",
    createdAt: "2026-09-09T12:00:00.000Z",
  };
  let receiptCalls = 0;
  const generated = ["transaction-1", "detail-1", "detail-2", "detail-3", "payment-1"];
  const useCase = new RequestPrepaidTransaction(
    persistence,
    { process: async () => { receiptCalls += 1; return storedReceipt; } },
    { generate: () => generated.shift() ?? "unexpected-id" },
  );
  return { persistence, useCase, receiptCalls: () => receiptCalls };
}

const command = {
  clientId: "client-1",
  accountId: "account-1",
  idempotencyKey: "request-1",
  details: [
    { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 500 },
    { platform: AdvertisingPlatform.GOOGLE, amount: 300 },
    { pautaId: "pauta-tiktok", platform: AdvertisingPlatform.TIKTOK, amount: 200 },
  ],
  receipt: upload,
};

describe("RequestPrepaidTransaction", () => {
  it("crea una transaccion, tres detalles, un pago y un comprobante", async () => {
    const { useCase, persistence, receiptCalls } = setup();
    const result = await useCase.execute(command);

    expect(result.id).toBe("transaction-1");
    expect(result.code).toBe("TX-transaction-1");
    expect(result.status).toBe(TransactionRechargeStatus.UNDER_REVIEW);
    expect(result.details).toHaveLength(3);
    expect(result.totals).toMatchObject({
      pautaAmount: 1000,
      isdAmount: 50,
      agencyCommissionAmount: 100,
      vatBaseAmount: 1150,
      vatAmount: 172.5,
      totalAmount: 1322.5,
    });
    expect(result.payment).toMatchObject({
      id: "payment-1",
      transactionId: "transaction-1",
      status: TransactionPaymentStatus.UNDER_REVIEW,
      expectedAmount: 1322.5,
    });
    expect(result.receipt.id).toBe("receipt-1");
    expect(receiptCalls()).toBe(1);
    expect(persistence.saved?.transaction.details).toHaveLength(3);
    expect(persistence.saved?.payment.expectedAmount.toSafeNumber()).toBe(1322.5);
  });

  it("devuelve la transaccion existente despues de resolver el owner y antes de almacenar el archivo", async () => {
    const { useCase, persistence, receiptCalls } = setup();
    const initial = await useCase.execute(command);
    persistence.saved = null;
    persistence.existing = initial;
    const callsBefore = persistence.loadCalls;

    const result = await useCase.execute(command);

    expect(result).toBe(initial);
    expect(persistence.loadCalls).toBe(callsBefore + 1);
    expect(receiptCalls()).toBe(1);
    expect(persistence.saved).toBeNull();
  });

  it("devuelve la ganadora que persistencia recupera ante una carrera idempotente", async () => {
    const { useCase, persistence } = setup();
    const originalSave = persistence.savePrepaid.bind(persistence);
    persistence.savePrepaid = async (record) => {
      const proposed = await originalSave(record);
      return { ...proposed, id: "transaction-winner", code: "TX-winner" };
    };

    const result = await useCase.execute(command);

    expect(result.id).toBe("transaction-winner");
    expect(result.code).toBe("TX-winner");
  });

  it("resuelve el cliente desde la cuenta cuando aun no existe principal autenticado", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ ...command, clientId: undefined });
    expect(result.clientId).toBe("client-1");
  });

  it("rechaza la cuenta cuando el principal autenticado pertenece a otro cliente", async () => {
    const { useCase, receiptCalls } = setup();
    await expect(useCase.execute({ ...command, clientId: "client-2" }))
      .rejects.toMatchObject({ code: "ACCOUNT_NOT_OWNED" });
    expect(receiptCalls()).toBe(0);
  });

  it.each([
    ["cliente inexistente", { ...activeContext(), client: null }, "CLIENT_NOT_FOUND"],
    ["cliente inactivo", { ...activeContext(), client: { id: "client-1", status: ClientStatus.INACTIVE } }, "CLIENT_INACTIVE"],
    ["cuenta inexistente", { ...activeContext(), account: null }, "ACCOUNT_NOT_FOUND"],
    ["contexto de cuenta inconsistente", { ...activeContext(), account: { ...activeContext().account!, clientId: "client-2" } }, "INVALID_ACCOUNT_CONTEXT"],
    ["cuenta inactiva", { ...activeContext(), account: { ...activeContext().account!, status: AccountStatus.INACTIVE } }, "ACCOUNT_INACTIVE"],
    ["cuenta postpago", { ...activeContext(), account: { ...activeContext().account!, type: AccountType.POSTPAID } }, "ACCOUNT_TYPE_MISMATCH"],
  ])("rechaza %s", async (_name, context, code) => {
    const { useCase, receiptCalls } = setup(context as MultiRechargeContext);
    await expect(useCase.execute(command)).rejects.toMatchObject({ code });
    expect(receiptCalls()).toBe(0);
  });

  it("rechaza detalles vacios, montos invalidos y comprobante ausente", async () => {
    const { useCase, receiptCalls } = setup();
    await expect(useCase.execute({ ...command, idempotencyKey: "empty", details: [] }))
      .rejects.toMatchObject({ code: "TRANSACTION_DETAILS_REQUIRED" });
    await expect(useCase.execute({ ...command, idempotencyKey: "zero", details: [{ platform: AdvertisingPlatform.META, amount: 0 }] }))
      .rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(useCase.execute({ ...command, idempotencyKey: "receipt", receipt: undefined }))
      .rejects.toMatchObject({ code: "RECEIPT_REQUIRED" });
    expect(receiptCalls()).toBe(0);
  });

  it("valida plataforma soportada en runtime", async () => {
    const { useCase } = setup();
    await expect(useCase.execute({
      ...command,
      details: [{ platform: "LINKEDIN" as AdvertisingPlatform, amount: 100 }],
    })).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" });
  });

  it("resuelve por id con plataforma coincidente y por plataforma cuando no hay id", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      ...command,
      details: [
        { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 10 },
        { platform: AdvertisingPlatform.GOOGLE, amount: 20 },
      ],
    });
    expect(result.details.map((item) => item.pautaId)).toEqual(["pauta-meta", "pauta-google"]);
  });

  it.each([
    ["pauta inexistente", { pautaId: "missing", platform: AdvertisingPlatform.META, amount: 100 }, "PAUTA_NOT_FOUND"],
    ["plataforma distinta", { pautaId: "pauta-meta", platform: AdvertisingPlatform.GOOGLE, amount: 100 }, "PAUTA_PLATFORM_MISMATCH"],
  ])("rechaza %s", async (_name, detail, code) => {
    const { useCase, receiptCalls } = setup();
    await expect(useCase.execute({ ...command, details: [detail] })).rejects.toMatchObject({ code });
    expect(receiptCalls()).toBe(0);
  });

  it("rechaza pautas inactivas y pautas repetidas", async () => {
    const inactive = activeContext();
    inactive.pautas = [pauta("pauta-meta", AdvertisingPlatform.META, PautaStatus.SUSPENDED)];
    const suspendedSetup = setup(inactive);
    await expect(suspendedSetup.useCase.execute({ ...command, details: [command.details[0]] }))
      .rejects.toMatchObject({ code: "PAUTA_NOT_ACTIVE" });

    const duplicateSetup = setup();
    await expect(duplicateSetup.useCase.execute({
      ...command,
      details: [
        { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 10 },
        { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 20 },
      ],
    })).rejects.toMatchObject({ code: "DUPLICATE_PAUTA" });
    expect(duplicateSetup.receiptCalls()).toBe(0);
  });

  it("rechaza dos pautas distintas de la misma plataforma", async () => {
    const context = activeContext();
    context.pautas = [
      pauta("pauta-meta-1", AdvertisingPlatform.META),
      pauta("pauta-meta-2", AdvertisingPlatform.META),
    ];
    const { useCase, receiptCalls } = setup(context);
    await expect(useCase.execute({
      ...command,
      details: [
        { pautaId: "pauta-meta-1", platform: AdvertisingPlatform.META, amount: 10 },
        { pautaId: "pauta-meta-2", platform: AdvertisingPlatform.META, amount: 20 },
      ],
    })).rejects.toMatchObject({ code: "DUPLICATE_PAUTA" });
    expect(receiptCalls()).toBe(0);
  });
});
