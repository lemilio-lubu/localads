import { MonetaryAmount } from "../value-objects/monetary-amount";
import { OcrAnalysis } from "./ocr-analysis";

/* Bancos y cooperativas por cuyo nombre se reconoce al ordenante. Se compara
   sobre el texto sin tildes («Pacífico» y «Pacifico» son el mismo). Los de
   Colombia se conservan: ya había comprobantes de prueba con ellos. */
const knownBanks: Array<[RegExp, string]> = [
  [/\bBANCO\s+PICHINCHA\b/, "BANCO PICHINCHA"],
  [/\bBANCO\s+(?:DE\s+)?GUAYAQUIL\b/, "BANCO GUAYAQUIL"],
  [/\bBANCO\s+(?:DEL\s+)?PACIFICO\b/, "BANCO DEL PACIFICO"],
  [/\bPRODUBANCO\b/, "PRODUBANCO"],
  [/\bBANCO\s+INTERNACIONAL\b/, "BANCO INTERNACIONAL"],
  [/\bBANCO\s+BOLIVARIANO\b/, "BANCO BOLIVARIANO"],
  [/\bBANCO\s+(?:DEL\s+)?AUSTRO\b/, "BANCO DEL AUSTRO"],
  [/\bBANCO\s+DE\s+LOJA\b/, "BANCO DE LOJA"],
  [/\bBANCO\s+(?:DE\s+)?MACHALA\b/, "BANCO DE MACHALA"],
  [/\bBANCO\s+GENERAL\s+RUMINAHUI\b/, "BANCO GENERAL RUMINAHUI"],
  [/\bBANCO\s+AMAZONAS\b/, "BANCO AMAZONAS"],
  [/\bBANCO\s+SOLIDARIO\b/, "BANCO SOLIDARIO"],
  [/\bBANCO\s+PROCREDIT\b/, "BANCO PROCREDIT"],
  [/\bBAN\s?ECUADOR\b/, "BANECUADOR"],
  [/\bCOOP(?:ERATIVA|\.)?\s*JEP\b/, "COOPERATIVA JEP"],
  [/\bJARDIN\s+AZUAYO\b/, "COOPERATIVA JARDIN AZUAYO"],
  [/\b29\s+DE\s+OCTUBRE\b/, "COOPERATIVA 29 DE OCTUBRE"],
  [/\bALIANZA\s+DEL\s+VALLE\b/, "COOPERATIVA ALIANZA DEL VALLE"],
  [/\bDEUNA\b/, "DEUNA"],
  [/\bBANCOLOMBIA\b/, "BANCOLOMBIA"],
  [/\bDAVIVIENDA\b/, "DAVIVIENDA"],
  [/\bBANCO\s+DE\s+BOGOTA\b/, "BANCO DE BOGOTA"],
];

/* Líneas que hablan del receptor (nosotros): su banco no es el del pago. */
const destinationLine = /\b(?:DESTINO|BENEFICIARI[OA]|RECEPTOR|ACREDITAD[OA]|PARA)\b/;

/* Una cifra nunca cruza de línea ni lleva espacios: con \s, «$33,06» seguido
   de la fecha en la línea de abajo se leía como 330621,00. */
const NUMBER = String.raw`\d[\d.,]*\d|\d`;
const amountPatterns = [
  new RegExp(String.raw`(?:US\$|\$|USD)[ \t]*(${NUMBER})`, "g"),
  new RegExp(String.raw`(?:TOTAL|MONTO|VALOR|IMPORTE|COP)\b[^\n\d$]{0,30}(${NUMBER})`, "g"),
  new RegExp(String.raw`(${NUMBER})[ \t]*(?:USD|US\$|DOLARES|DOLAR)\b`, "g"),
];

const months: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };

/* Etiquetas del número que da el banco, de más a menos fiables. «Referencia»
   va aparte y al final: suele ser el texto que escribe el cliente. */
const bankNumberLabels = [
  String.raw`N(?:O|RO|UM|UMERO)?\.?\s*(?:DE\s+)?(?:COMPROBANTE|DOCUMENTO|TRANSACCION|OPERACION|REFERENCIA)`,
  String.raw`SECUENCIAL`,
  String.raw`CODIGO(?:\s+DE\s+TRANSACCION)?`,
  String.raw`COMPROBANTE`,
  String.raw`DOCUMENTO`,
  String.raw`OPERACION`,
];
/* El valor necesita al menos una cifra («Comprobante de transferencia» no es
   una referencia) y no puede ser una fecha. */
const referenceValue = String.raw`\s*[:#.\-]?\s*((?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,39})`;
const looksLikeDate = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}$/;

/** Mayúsculas y sin tildes: «Pacífico», «transacción» y «Número» se comparan como en el texto plano. */
export function plainText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function parseLocalizedAmount(raw: string): MonetaryAmount | null {
  const compact = raw.replace(/[.,]+$/, "");
  const lastSeparator = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  const decimalDigits = lastSeparator >= 0 ? compact.length - lastSeparator - 1 : 0;
  const normalized = decimalDigits === 1 || decimalDigits === 2
    ? `${compact.slice(0, lastSeparator).replace(/[.,]/g, "")}.${compact.slice(lastSeparator + 1)}`
    : compact.replace(/[.,]/g, "");
  try {
    return MonetaryAmount.fromMajorUnits(normalized);
  } catch {
    return null;
  }
}

function extractAmounts(text: string): MonetaryAmount[] {
  const found = amountPatterns
    .flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ at: match.index ?? 0, raw: match[1] })))
    .sort((a, b) => a.at - b.at);
  const unique = new Map<string, MonetaryAmount>();
  for (const { raw } of found) {
    const amount = parseLocalizedAmount(raw);
    if (amount && !amount.isZero && !unique.has(amount.toMajorUnits())) unique.set(amount.toMajorUnits(), amount);
  }
  return [...unique.values()];
}

function extractBank(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => !destinationLine.test(line));
  for (const line of lines) {
    for (const [pattern, bank] of knownBanks) if (pattern.test(line)) return bank;
  }
  for (const line of lines) {
    const labelled = /(?:BANCO|ENTIDAD)\s*:\s*([^\r\n]{3,50})/.exec(line)?.[1]?.trim();
    if (labelled) return labelled.replace(/\s{2,}.*/, "");
  }
  return null;
}

function validUtcDate(year: number, month: number, day: number): Date | null {
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? result
    : null;
}

function extractDate(text: string): Date | null {
  const iso = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/.exec(text);
  if (iso) return validUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:20)?\d{2})\b/.exec(text);
  if (local) {
    const shortYear = Number(local[3]);
    return validUtcDate(shortYear < 100 ? 2000 + shortYear : shortYear, Number(local[2]), Number(local[1]));
  }
  /* «21 oct. 2026», «21 de octubre de 2026», «05 SEPT 2026»: el formato de
     las apps bancarias, que antes acababa en «fecha fuera de rango». */
  const written = /\b(0?[1-9]|[12]\d|3[01])(?:\s+DE)?\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEPT?|SET|OCT|NOV|DIC)[A-Z]*\.?(?:\s+DEL?)?\s+(20\d{2})\b/.exec(text);
  if (!written) return null;
  return validUtcDate(Number(written[3]), months[written[2].slice(0, 3)], Number(written[1]));
}

function extractReference(text: string): string | null {
  for (const labels of [bankNumberLabels, ["REFERENCIA"]]) {
    const pattern = new RegExp(`(?:${labels.join("|")})${referenceValue}`, "g");
    for (const match of text.matchAll(pattern)) {
      if (!looksLikeDate.test(match[1])) return match[1];
    }
  }
  return null;
}

function extractOrderingParty(text: string, plain: string): string | null {
  const match = /(?:ORDENANTE|REMITENTE|PAGADOR|DEBITADO\s+DE)\s*:\s*([^\r\n]{3,100})/.exec(plain);
  if (!match || match.index === undefined) return null;
  // Se devuelve con las tildes y mayúsculas originales: es un nombre propio.
  const start = match.index + match[0].length - match[1].length;
  return text.slice(start, start + match[1].length).trim();
}

/** Deterministic interpretation of OCR text; it does not approve or reject anything. */
export class ReceiptTextInterpreter {
  interpret(text: string, confidence: number): OcrAnalysis {
    const plain = plainText(text);
    return {
      originalText: text,
      confidence,
      detectedAmounts: extractAmounts(plain),
      bank: extractBank(plain),
      transactionDate: extractDate(plain),
      bankReference: extractReference(plain),
      orderingParty: extractOrderingParty(text, plain),
    };
  }
}
