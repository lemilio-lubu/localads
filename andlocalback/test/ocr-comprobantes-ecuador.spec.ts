import { describe, expect, it } from "vitest";
import { ReceiptTextInterpreter } from "../src/modules/recharges/domain/ocr/receipt-text-interpreter";
import { TransactionVerificationPolicy } from "../src/modules/recharges/domain/policies/transaction-verification.policy";
import { VerificationIssue, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";

/* Comprobantes como los de las apps bancarias de Ecuador. El primero es el
   texto tal cual lo leyó Tesseract de una captura de móvil (94% de confianza):
   la lectura era buena, la interpretación no. */
const interpreter = new ReceiptTextInterpreter();
const amounts = (text: string) => interpreter.interpret(text, 90).detectedAmounts.map((amount) => amount.toMajorUnits());
const day = (text: string) => interpreter.interpret(text, 90).transactionDate?.toISOString().slice(0, 10) ?? null;

const tesseractMovil = `¡Transferencia exitosa!
$33,06
21 oct. 2026 - 19:05
Desde: Cuenta de ahorros ****4821
Para: AND LOCAL ADS S.A.
Banco destino: Produbanco
Descripción: TX-f6789e61
Comprobante: 0045821137
Comisión: $0,41`;

describe("monto: no se mezcla con la línea siguiente", () => {
  it("lee $33,06 aunque la fecha vaya justo debajo (antes salía 330621,00)", () => {
    expect(amounts("Monto: $33,06\n21/10/2026 19:05")).toEqual(["33.06"]);
    expect(amounts(tesseractMovil)).toEqual(["33.06", "0.41"]);
  });

  it("lee el valor con texto entre la etiqueta y la cifra (antes 198382026,00)", () => {
    expect(amounts("Valor transferido $ 198,38\n2026-10-21")).toEqual(["198.38"]);
  });

  it("lee miles con punto y US$ (antes 11373521,00)", () => {
    expect(amounts("US$ 1.137,35\n21 de octubre de 2026")).toEqual(["1137.35"]);
  });

  it("separa monto, comisión y total debitado", () => {
    expect(amounts("Monto: $198,38\nComisión: $0,41\nTotal debitado: $198,79\n21/10/2026")).toEqual(["198.38", "0.41", "198.79"]);
  });

  it("lee el monto con la moneda detrás", () => {
    expect(amounts("Transferencia\n33.06 USD\n21-10-2026")).toEqual(["33.06"]);
    expect(amounts("Enviaste 50,00 dólares")).toEqual(["50.00"]);
  });

  it("ignora el punto final de una frase", () => {
    expect(amounts("Transferiste $25,00.")).toEqual(["25.00"]);
  });
});

describe("fecha: también escrita con el mes en letras", () => {
  it("entiende «21 oct. 2026», «21 de octubre de 2026» y «Fecha: 21 oct 2026»", () => {
    expect(day(tesseractMovil)).toBe("2026-10-21");
    expect(day("21 de octubre de 2026")).toBe("2026-10-21");
    expect(day("Fecha: 21 oct 2026")).toBe("2026-10-21");
    expect(day("05 SEPT 2026")).toBe("2026-09-05");
  });

  it("descarta fechas imposibles", () => {
    expect(day("31 de febrero de 2026")).toBeNull();
  });
});

describe("banco: el que paga, no el de destino", () => {
  it("no confunde el banco destino con el del ordenante", () => {
    expect(interpreter.interpret(tesseractMovil, 90).bank).toBeNull();
    expect(interpreter.interpret("Banco Pichincha\nTransferencia\nBanco destino: Produbanco", 90).bank).toBe("BANCO PICHINCHA");
    expect(interpreter.interpret("Banco beneficiario: Banco Guayaquil\nDesde Banco Bolivariano", 90).bank).toBe("BANCO BOLIVARIANO");
  });

  it("reconoce bancos y cooperativas de Ecuador, con o sin tilde", () => {
    const cases: Array<[string, string]> = [
      ["Banco del Pacífico", "BANCO DEL PACIFICO"],
      ["BANCO INTERNACIONAL", "BANCO INTERNACIONAL"],
      ["Banco Bolivariano", "BANCO BOLIVARIANO"],
      ["Banco del Austro", "BANCO DEL AUSTRO"],
      ["Banco de Loja", "BANCO DE LOJA"],
      ["Banco de Machala", "BANCO DE MACHALA"],
      ["BanEcuador", "BANECUADOR"],
      ["Banco General Rumiñahui", "BANCO GENERAL RUMINAHUI"],
      ["Coop. JEP", "COOPERATIVA JEP"],
      ["Cooperativa Jardín Azuayo", "COOPERATIVA JARDIN AZUAYO"],
      ["DeUna!", "DEUNA"],
    ];
    for (const [text, bank] of cases) expect(interpreter.interpret(`${text}\nMonto $10,00`, 90).bank).toBe(bank);
  });
});

describe("referencia: el número del banco", () => {
  it("reconoce las etiquetas habituales de los comprobantes ecuatorianos", () => {
    const reference = (text: string) => interpreter.interpret(text, 90).bankReference;
    expect(reference(tesseractMovil)).toBe("0045821137");
    expect(reference("Número de comprobante: 0012345678")).toBe("0012345678");
    expect(reference("No. de documento 554433")).toBe("554433");
    expect(reference("Secuencial: 7788990")).toBe("7788990");
    expect(reference("Nro. transacción 112233")).toBe("112233");
  });

  it("no toma palabras sueltas como referencia ni el título del comprobante", () => {
    expect(interpreter.interpret("Comprobante de transferencia\nMonto $10,00", 90).bankReference).toBeNull();
  });

  it("prefiere el número del banco a la referencia escrita por el cliente", () => {
    expect(interpreter.interpret("Referencia: TX-f6789e61\nNúmero de comprobante: 0012345678", 90).bankReference).toBe("0012345678");
  });
});

describe("código de nuestra transacción en el comprobante", () => {
  const policy = new TransactionVerificationPolicy();
  const evaluatedAt = new Date("2026-10-21T23:00:00.000Z");
  const code = "TX-f6789e61-5c43-400a-bc44-e256d0bc1297";
  const evaluate = (text: string) => policy.evaluate({
    expectedAmount: MonetaryAmount.fromMajorUnits("33.06"),
    ocr: interpreter.interpret(`Banco Pichincha\n${text}`, 95),
    transactionCode: code,
    evaluatedAt,
  });

  it("lo encuentra aunque el banco corte la descripción o el OCR lea O por 0", () => {
    for (const written of [code, "TX-f6789e61", "f6789e61", "TX-F6789E61-5C43", "TX-f6789e6l", "tx f6789e61"]) {
      expect(evaluate(`${tesseractMovil.replace("TX-f6789e61", written)}`).issues).not.toContain(VerificationIssue.TRANSACTION_CODE_NOT_FOUND);
    }
  });

  it("con monto, fecha, banco, referencia y código, queda verificado automáticamente", () => {
    const result = evaluate(tesseractMovil);
    expect(result.issues).toEqual([]);
    expect(result.status).toBe(VerificationStatus.AUTOMATICALLY_VERIFIED);
    expect(result.amountMatches).toBe(true);
  });

  it("si el comprobante no menciona el código, lo señala para la revisión", () => {
    const result = evaluate(tesseractMovil.replace("Descripción: TX-f6789e61", "Descripción: pago publicidad"));
    expect(result.issues).toContain(VerificationIssue.TRANSACTION_CODE_NOT_FOUND);
    expect(result.status).toBe(VerificationStatus.UNDER_REVIEW);
  });

  it("sin código esperado (comprobantes antiguos) no exige nada nuevo", () => {
    const result = policy.evaluate({ expectedAmount: MonetaryAmount.fromMajorUnits("33.06"), ocr: interpreter.interpret(`Banco Pichincha\n${tesseractMovil}`, 95), evaluatedAt });
    expect(result.issues).not.toContain(VerificationIssue.TRANSACTION_CODE_NOT_FOUND);
  });
});
