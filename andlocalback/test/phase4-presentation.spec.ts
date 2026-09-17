import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import { OverduePaymentsRunner } from "../src/modules/recharges/application/services/overdue-payments-runner";
import { MarkOverduePayments } from "../src/modules/recharges/application/use-cases/mark-overdue-payments";
import { RequestPostpaidTransaction, RequestPostpaidTransactionCommand } from "../src/modules/recharges/application/use-cases/request-postpaid-transaction";
import { RequestPrepaidTransaction } from "../src/modules/recharges/application/use-cases/request-prepaid-transaction";
import { TransactionReceiptOcrDispatcher } from "../src/modules/recharges/application/services/transaction-receipt-ocr-dispatcher";
import { AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { RequestPostpaidTransactionDto } from "../src/modules/recharges/presentation/dto/request-postpaid-transaction.dto";
import { TransactionsController } from "../src/modules/recharges/presentation/transactions.controller";

describe("Fase 4 - DTO JSON postpago", () => {
  it("valida una distribucion de varias pautas y elimina campos no publicos", async () => {
    const dto = plainToInstance(RequestPostpaidTransactionDto, {
      clientId: "client-forged",
      accountId: "account-postpaid",
      receipt: "not-accepted",
      details: [
        { pautaId: "pauta-meta", platform: "META", amount: "500.00" },
        { pautaId: "pauta-google", platform: "GOOGLE", amount: "300" },
      ],
    });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.details).toHaveLength(2);
    expect(dto).not.toHaveProperty("clientId");
    expect(dto).not.toHaveProperty("receipt");
  });

  it.each(["0", "0.00", "1.001", "-1", "texto"])("rechaza el monto invalido %s", async (amount) => {
    const dto = plainToInstance(RequestPostpaidTransactionDto, {
      accountId: "account-postpaid",
      details: [{ pautaId: "pauta-meta", platform: "META", amount }],
    });

    expect(await validate(dto)).not.toEqual([]);
  });
});

describe("Fase 4 - endpoint postpago", () => {
  function setup() {
    let received: RequestPostpaidTransactionCommand | undefined;
    const postpaid = {
      execute: vi.fn(async (command: RequestPostpaidTransactionCommand) => {
        received = command;
        return { id: "transaction-postpaid-001" };
      }),
    };
    const controller = new TransactionsController(
      { execute: vi.fn() } as unknown as RequestPrepaidTransaction,
      { dispatch: vi.fn() } as unknown as TransactionReceiptOcrDispatcher,
      postpaid as unknown as RequestPostpaidTransaction,
    );
    return { controller, postpaid, received: () => received };
  }

  it("mapea JSON a una sola solicitud sin clientId ni comprobante", async () => {
    const { controller, received } = setup();
    await controller.requestPostpaid({
      accountId: "account-postpaid",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: "500.00" }],
    }, "postpaid-key-001");

    expect(received()).toEqual({
      accountId: "account-postpaid",
      idempotencyKey: "postpaid-key-001",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 500 }],
    });
    expect(received()).not.toHaveProperty("clientId");
    expect(received()).not.toHaveProperty("receipt");
  });

  it("requiere una clave de idempotencia valida", async () => {
    const { controller, postpaid } = setup();
    await expect(controller.requestPostpaid({
      accountId: "account-postpaid",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: "500" }],
    }, "bad key")).rejects.toEqual(expect.objectContaining({
      code: "INVALID_IDEMPOTENCY_KEY",
    } satisfies Partial<ApplicationError>));
    expect(postpaid.execute).not.toHaveBeenCalled();
  });
});

describe("Fase 4 - runner de vencimientos", () => {
  it("evita ejecuciones solapadas", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async () => {
      await pending;
      return { markedCount: 0, processedAt: new Date().toISOString() };
    });
    const runner = new OverduePaymentsRunner({ execute } as unknown as MarkOverduePayments);

    const first = runner.runOnce();
    await runner.runOnce();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("libera su temporizador al destruir el modulo", () => {
    vi.useFakeTimers();
    const execute = vi.fn(async () => ({ markedCount: 0, processedAt: new Date().toISOString() }));
    const runner = new OverduePaymentsRunner({ execute } as unknown as MarkOverduePayments);
    runner.onModuleInit();
    runner.onModuleDestroy();
    vi.advanceTimersByTime(120_000);
    expect(execute).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
