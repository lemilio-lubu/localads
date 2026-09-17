import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import {
  RequestPrepaidTransaction,
  RequestPrepaidTransactionCommand,
} from "../src/modules/recharges/application/use-cases/request-prepaid-transaction";
import { AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import {
  RequestPrepaidTransactionDto,
} from "../src/modules/recharges/presentation/dto/request-prepaid-transaction.dto";
import { TransactionsController } from "../src/modules/recharges/presentation/transactions.controller";
import { TransactionReceiptOcrDispatcher } from "../src/modules/recharges/application/services/transaction-receipt-ocr-dispatcher";
import { RequestPostpaidTransaction } from "../src/modules/recharges/application/use-cases/request-postpaid-transaction";

describe("Fase 2 - DTO multipart de transaccion prepago", () => {
  it("transforma y valida detalles serializados como JSON", async () => {
    const dto = plainToInstance(RequestPrepaidTransactionDto, {
      accountId: "account-prepaid",
      details: JSON.stringify([
        { pautaId: "pauta-meta", platform: "META", amount: "500.00" },
        { pautaId: "pauta-google", platform: "GOOGLE", amount: "300" },
      ]),
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.details).toHaveLength(2);
    expect(dto.details[0].platform).toBe(AdvertisingPlatform.META);
  });

  it("rechaza JSON mal formado con un codigo estable", () => {
    expect(() => plainToInstance(RequestPrepaidTransactionDto, {
      accountId: "account-prepaid",
      details: "[{",
    })).toThrowError(expect.objectContaining({ code: "INVALID_DETAILS_JSON" }));
  });

  it.each(["0", "0.00", "1.001", "-1", "texto"])("rechaza el monto invalido %s", async (amount) => {
    const dto = plainToInstance(RequestPrepaidTransactionDto, {
      accountId: "account-prepaid",
      details: JSON.stringify([{ pautaId: "pauta-meta", platform: "META", amount }]),
    });

    expect(await validate(dto)).not.toEqual([]);
  });
});

describe("Fase 2 - TransactionsController", () => {
  const file = {
    originalname: "comprobante.png",
    mimetype: "image/png",
    size: 8,
    buffer: Buffer.from("receipt"),
  } as Express.Multer.File;

  function setup() {
    let received: RequestPrepaidTransactionCommand | undefined;
    const requestUseCase = {
      execute: vi.fn(async (command: RequestPrepaidTransactionCommand) => {
        received = command;
        return { id: "transaction-001", receipt: { id: "receipt-001" } };
      }),
    };
    const dispatcher = { dispatch: vi.fn() };
    const controller = new TransactionsController(
      requestUseCase as unknown as RequestPrepaidTransaction,
      dispatcher as unknown as TransactionReceiptOcrDispatcher,
      { execute: vi.fn() } as unknown as RequestPostpaidTransaction,
    );
    return { controller, requestUseCase, dispatcher, received: () => received };
  }

  it("mapea el multipart sin aceptar clientId publico", async () => {
    const { controller, dispatcher, received } = setup();
    await controller.requestPrepaid({
      accountId: "account-prepaid",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: "500.00" }],
    }, "request-key-001", file);

    expect(received()).toMatchObject({
      accountId: "account-prepaid",
      idempotencyKey: "request-key-001",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: 500 }],
      receipt: { originalName: "comprobante.png", mimeType: "image/png", size: 8 },
    });
    expect(received()).not.toHaveProperty("clientId");
    expect(dispatcher.dispatch).toHaveBeenCalledWith("receipt-001");
  });

  it("requiere Idempotency-Key antes de ejecutar el caso de uso", async () => {
    const { controller, requestUseCase } = setup();
    await expect(controller.requestPrepaid({
      accountId: "account-prepaid",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: "500.00" }],
    }, undefined, file)).rejects.toEqual(expect.objectContaining({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    } satisfies Partial<ApplicationError>));
    expect(requestUseCase.execute).not.toHaveBeenCalled();
  });

  it("requiere un unico comprobante", async () => {
    const { controller, requestUseCase } = setup();
    await expect(controller.requestPrepaid({
      accountId: "account-prepaid",
      details: [{ pautaId: "pauta-meta", platform: AdvertisingPlatform.META, amount: "500.00" }],
    }, "request-key-001", undefined)).rejects.toMatchObject({ code: "RECEIPT_REQUIRED" });
    expect(requestUseCase.execute).not.toHaveBeenCalled();
  });
});
