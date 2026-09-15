import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { CompleteTransaction } from "../src/modules/recharges/application/use-cases/complete-transaction";
import { CompleteTransactionDetail } from "../src/modules/recharges/application/use-cases/complete-transaction-detail";
import { StartTransactionRecharge } from "../src/modules/recharges/application/use-cases/start-transaction-recharge";
import { CompleteTransactionDetailDto } from "../src/modules/recharges/presentation/dto/complete-transaction-detail.dto";
import { TransactionExecutionController } from "../src/modules/recharges/presentation/transaction-execution.controller";

describe("Fase 5 - DTO de ejecucion de recarga", () => {
  it("acepta dinero decimal como string y una fecha ISO opcional", async () => {
    const dto = plainToInstance(CompleteTransactionDetailDto, {
      effectiveAmount: "475.25",
      effectiveRechargeDate: "2026-09-10T15:30:00.000Z",
      status: "COMPLETED",
      clientId: "client-forged",
    });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto).toEqual({
      effectiveAmount: "475.25",
      effectiveRechargeDate: "2026-09-10T15:30:00.000Z",
    });
  });

  it.each([0, 10, "0", "0.00", "1.001", "-1", "texto"])(
    "rechaza el monto efectivo invalido %s",
    async (effectiveAmount) => {
      const dto = plainToInstance(CompleteTransactionDetailDto, { effectiveAmount });
      expect(await validate(dto)).not.toEqual([]);
    },
  );

  it("rechaza fechas no ISO", async () => {
    const dto = plainToInstance(CompleteTransactionDetailDto, {
      effectiveAmount: "100.00",
      effectiveRechargeDate: "10/09/2026",
    });
    expect(await validate(dto)).not.toEqual([]);
  });
});

describe("Fase 5 - endpoints de ejecucion", () => {
  function setup() {
    const start = { execute: vi.fn(async () => ({ transactionId: "tx-001", status: "PROCESSING" })) };
    const detail = { execute: vi.fn(async () => ({ transactionId: "tx-001", detailId: "detail-001" })) };
    const complete = {
      execute: vi.fn(async () => ({
        transaction: { transactionId: "tx-001", status: "COMPLETED" },
        invoice: { id: "invoice-001", number: "FAC-001", status: "ISSUED" },
      })),
    };
    const controller = new TransactionExecutionController(
      start as unknown as StartTransactionRecharge,
      detail as unknown as CompleteTransactionDetail,
      complete as unknown as CompleteTransaction,
    );
    return { controller, start, detail, complete };
  }

  it("inicia una transaccion sin aceptar un estado desde HTTP", async () => {
    const { controller, start } = setup();
    await controller.start("tx-001");
    expect(start.execute).toHaveBeenCalledWith({ transactionId: "tx-001" });
  });

  it("completa un detalle con monto numerico y fecha efectiva", async () => {
    const { controller, detail } = setup();
    await controller.completeDetail("tx-001", "detail-001", {
      effectiveAmount: "475.25",
      effectiveRechargeDate: "2026-09-10T15:30:00.000Z",
    });

    expect(detail.execute).toHaveBeenCalledWith({
      transactionId: "tx-001",
      detailId: "detail-001",
      effectiveAmount: 475.25,
      effectiveRechargeDate: new Date("2026-09-10T15:30:00.000Z"),
    });
  });

  it("cierra la transaccion y devuelve el resultado con su factura", async () => {
    const { controller, complete } = setup();
    const result = await controller.complete("tx-001");
    expect(complete.execute).toHaveBeenCalledWith({ transactionId: "tx-001" });
    expect(result).toMatchObject({
      transaction: { status: "COMPLETED" },
      invoice: { id: "invoice-001", status: "ISSUED" },
    });
  });
});
