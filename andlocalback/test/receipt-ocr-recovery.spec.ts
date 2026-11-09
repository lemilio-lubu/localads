import { describe, expect, it, vi } from "vitest";
import { ReceiptOcrRecoveryRunner } from "../src/modules/recharges/application/services/receipt-ocr-recovery-runner";
import { TransactionReceiptOcrDispatcher } from "../src/modules/recharges/application/services/transaction-receipt-ocr-dispatcher";
import { ProcessTransactionReceiptOcr } from "../src/modules/recharges/application/use-cases/process-transaction-receipt-ocr";
import { RecoverUnreadReceipts, UNREAD_RECEIPT_GRACE_MS } from "../src/modules/recharges/application/use-cases/recover-unread-receipts";

const NOW = new Date("2026-11-08T12:00:00.000Z");

function recovery(unread: string[], fails: (receiptId: string) => boolean = () => false) {
  const listUnreadReceipts = vi.fn(async () => unread);
  const execute = vi.fn(async ({ receiptId }: { receiptId: string }) => {
    if (fails(receiptId)) throw new Error("almacenamiento caido");
    return {} as Awaited<ReturnType<ProcessTransactionReceiptOcr["execute"]>>;
  });
  return { listUnreadReceipts, execute, useCase: new RecoverUnreadReceipts({ listUnreadReceipts }, { execute }, () => NOW) };
}

describe("RecoverUnreadReceipts", () => {
  it("lee los comprobantes subidos antes del margen, de uno en uno y como mucho cinco", async () => {
    const { listUnreadReceipts, execute, useCase } = recovery(["r1", "r2", "r3", "r4", "r5", "r6"]);

    const result = await useCase.execute();

    expect(listUnreadReceipts).toHaveBeenCalledWith(new Date(NOW.getTime() - UNREAD_RECEIPT_GRACE_MS), 20);
    expect(execute.mock.calls.map(([command]) => command.receiptId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(result).toEqual({ recovered: ["r1", "r2", "r3", "r4", "r5"], failed: [] });
  });

  it("un fallo no corta el lote y salta los que se le indican", async () => {
    const { execute, useCase } = recovery(["r1", "r2", "r3"], (receiptId) => receiptId === "r2");

    const result = await useCase.execute({ skip: (receiptId) => receiptId === "r1" });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ recovered: ["r3"], failed: [{ receiptId: "r2", reason: "almacenamiento caido" }] });
  });
});

describe("ReceiptOcrRecoveryRunner", () => {
  function runner(unread: string[], fails: (receiptId: string) => boolean, inFlight: string[] = []) {
    let clock = NOW.getTime();
    const { execute, useCase } = recovery(unread, fails);
    const dispatcher = { isInFlight: (receiptId: string) => inFlight.includes(receiptId) } as TransactionReceiptOcrDispatcher;
    return { execute, advance: (ms: number) => { clock += ms; }, runner: new ReceiptOcrRecoveryRunner(useCase, dispatcher, () => clock) };
  }

  it("no relee lo que el despachador esta leyendo", async () => {
    const { execute, runner: subject } = runner(["r1", "r2"], () => false, ["r1"]);
    await subject.runOnce();
    expect(execute.mock.calls.map(([command]) => command.receiptId)).toEqual(["r2"]);
  });

  it("espera cada vez mas antes de reintentar un comprobante que falla", async () => {
    const { execute, advance, runner: subject } = runner(["r1"], () => true);

    await subject.runOnce();
    advance(60_000);
    await subject.runOnce();
    expect(execute).toHaveBeenCalledTimes(1);

    advance(60_000);
    await subject.runOnce();
    expect(execute).toHaveBeenCalledTimes(2);

    advance(2 * 60_000);
    await subject.runOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    advance(2 * 60_000);
    await subject.runOnce();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("libera su temporizador al destruir el modulo", () => {
    vi.useFakeTimers();
    const { execute, runner: subject } = runner(["r1"], () => false);
    subject.onModuleInit();
    subject.onModuleDestroy();
    vi.advanceTimersByTime(10 * 60_000);
    expect(execute).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("TransactionReceiptOcrDispatcher", () => {
  it("recuerda el comprobante mientras lo lee y lo olvida al terminar, aunque falle", async () => {
    let finish!: () => void;
    const execute = vi.fn(() => new Promise<never>((_, reject) => { finish = () => reject(new Error("ilegible")); }));
    const dispatcher = new TransactionReceiptOcrDispatcher({ execute } as unknown as ProcessTransactionReceiptOcr);

    dispatcher.dispatch("r1");
    expect(dispatcher.isInFlight("r1")).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(dispatcher.isInFlight("r1")).toBe(false);
  });
});
