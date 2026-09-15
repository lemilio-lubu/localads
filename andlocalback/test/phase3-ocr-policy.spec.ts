import { describe, expect, it } from "vitest";
import { ReceiptTextInterpreter } from "../src/modules/recharges/domain/ocr/receipt-text-interpreter";
import { TransactionVerificationPolicy } from "../src/modules/recharges/domain/policies/transaction-verification.policy";
import { VerificationIssue, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";

const interpreter = new ReceiptTextInterpreter();
const evaluatedAt = new Date("2026-09-09T18:00:00.000Z");

describe("ReceiptTextInterpreter", () => {
  it("extrae evidencia rica sin tomar una decision financiera", () => {
    const result = interpreter.interpret(`
      BANCO PICHINCHA
      TOTAL: $ 1.058,00
      Fecha: 09/09/2026
      Codigo de transaccion: 123456ABC
      Ordenante: ACME PUBLICIDAD S.A.
    `, 96);

    expect(result.originalText).toContain("BANCO PICHINCHA");
    expect(result.confidence).toBe(96);
    expect(result.detectedAmounts.map((amount) => amount.toMajorUnits())).toContain("1058.00");
    expect(result.bank).toBe("BANCO PICHINCHA");
    expect(result.transactionDate?.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(result.bankReference).toBe("123456ABC");
    expect(result.orderingParty).toBe("ACME PUBLICIDAD S.A.");
  });

  it("acepta formatos habituales de monto y fecha ISO", () => {
    const result = interpreter.interpret("Bancolombia VALOR COP 1.250.000 FECHA 2026-09-08 REFERENCIA AB-998877", 91);
    expect(result.detectedAmounts[0].toMajorUnits()).toBe("1250000.00");
    expect(result.transactionDate?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(result.bankReference).toBe("AB-998877");
  });
});

describe("TransactionVerificationPolicy", () => {
  it("marca verificacion automatica si toda la evidencia coincide, pero mantiene aprobacion admin en MVP", () => {
    const ocr = interpreter.interpret(
      "BANCOLOMBIA TOTAL $1.058,00 FECHA 09/09/2026 REFERENCIA ABC12345",
      97,
    );
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("1058.00"),
      ocr,
      evaluatedAt,
    });

    expect(result.status).toBe(VerificationStatus.AUTOMATICALLY_VERIFIED);
    expect(result.issues).toEqual([]);
    expect(result.amountMatches).toBe(true);
    expect(result.requiresAdministratorApproval).toBe(true);
    expect(result.rejectsPayment).toBe(false);
  });

  it("envia a revision una referencia bancaria repetida aunque el monto sea correcto", () => {
    const ocr = interpreter.interpret(
      "DAVIVIENDA TOTAL $800.00 FECHA 09/09/2026 CODIGO 123456",
      98,
    );
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("800.00"),
      ocr,
      bankReferenceAlreadyConfirmed: true,
      evaluatedAt,
    });

    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
    expect(result.amountMatches).toBe(true);
    expect(result.issues).toContain(VerificationIssue.DUPLICATE_BANK_REFERENCE);
  });

  it("detecta comprobante repetido de manera independiente al codigo bancario", () => {
    const ocr = interpreter.interpret(
      "BANCO GUAYAQUIL MONTO 500.00 FECHA 08/09/2026 OPERACION XYZ9999",
      95,
    );
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("500.00"),
      ocr,
      receiptAlreadyConfirmed: true,
      evaluatedAt,
    });
    expect(result.issues).toContain(VerificationIssue.DUPLICATE_RECEIPT);
    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
  });

  it("un fallo OCR conserva el pago para revision y nunca lo rechaza", () => {
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("800.00"),
      ocr: null,
      ocrFailure: { reason: "worker unavailable" },
      evaluatedAt,
    });

    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
    expect(result.issues).toContain(VerificationIssue.OCR_FAILURE);
    expect(result.issues).toContain(VerificationIssue.AMOUNT_NOT_FOUND);
    expect(result.rejectsPayment).toBe(false);
    expect(result.failureReason).toBe("worker unavailable");
  });

  it("detecta monto distinto, confianza baja, banco ausente y fecha fuera de rango", () => {
    const ocr = interpreter.interpret("TOTAL $750.00 FECHA 01/01/2025 REFERENCIA REF1234", 62);
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("800.00"),
      ocr,
      evaluatedAt,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      VerificationIssue.AMOUNT_MISMATCH,
      VerificationIssue.LOW_CONFIDENCE,
      VerificationIssue.BANK_NOT_IDENTIFIED,
      VerificationIssue.DATE_OUT_OF_RANGE,
    ]));
    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
  });

  it("no verifica automaticamente datos incompletos sin referencia bancaria", () => {
    const ocr = interpreter.interpret("BANCOLOMBIA TOTAL $800.00 FECHA 09/09/2026", 99);
    const result = new TransactionVerificationPolicy().evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("800.00"), ocr, evaluatedAt,
    });
    expect(result.issues).toContain(VerificationIssue.BANK_REFERENCE_NOT_IDENTIFIED);
    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
  });

  it("permite desactivar la aprobacion administrativa cuando negocio lo habilite", () => {
    const ocr = interpreter.interpret(
      "PRODUBANCO MONTO $100.00 FECHA 09/09/2026 REFERENCIA OK12345",
      99,
    );
    const result = new TransactionVerificationPolicy({ requireAdministratorApproval: false }).evaluate({
      expectedAmount: MonetaryAmount.fromMajorUnits("100.00"),
      ocr,
      evaluatedAt,
    });
    expect(result.status).toBe(VerificationStatus.AUTOMATICALLY_VERIFIED);
    expect(result.requiresAdministratorApproval).toBe(false);
  });
});
