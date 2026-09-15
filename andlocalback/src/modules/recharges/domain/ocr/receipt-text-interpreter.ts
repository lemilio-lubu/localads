import { MonetaryAmount } from "../value-objects/monetary-amount";
import { OcrAnalysis } from "./ocr-analysis";

const knownBanks: Array<[RegExp, string]> = [
  [/\bBANCO\s+PICHINCHA\b/i, "BANCO PICHINCHA"],
  [/\bBANCOLOMBIA\b/i, "BANCOLOMBIA"],
  [/\bDAVIVIENDA\b/i, "DAVIVIENDA"],
  [/\bBANCO\s+DE\s+BOGOTA\b/i, "BANCO DE BOGOTA"],
  [/\bBANCO\s+GUAYAQUIL\b/i, "BANCO GUAYAQUIL"],
  [/\bPRODUBANCO\b/i, "PRODUBANCO"],
  [/\bBANCO\s+DEL\s+PACIFICO\b/i, "BANCO DEL PACIFICO"],
];

function parseLocalizedAmount(raw: string): MonetaryAmount | null {
  const compact = raw.replace(/\s/g, "");
  const lastSeparator = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  const decimalDigits = lastSeparator >= 0 ? compact.length - lastSeparator - 1 : 0;
  const normalized = decimalDigits === 2
    ? `${compact.slice(0, lastSeparator).replace(/[.,]/g, "")}.${compact.slice(lastSeparator + 1)}`
    : compact.replace(/[.,]/g, "");
  try {
    return MonetaryAmount.fromMajorUnits(normalized);
  } catch {
    return null;
  }
}

function extractAmounts(text: string): MonetaryAmount[] {
  const matches = [...text.matchAll(/(?:\$|USD|COP|TOTAL|MONTO|VALOR|IMPORTE)\s*[:$]?\s*(\d[\d.,\s]*)/gi)];
  const unique = new Map<string, MonetaryAmount>();
  for (const match of matches) {
    const amount = parseLocalizedAmount(match[1]);
    if (amount && !amount.isZero) unique.set(amount.toMajorUnits(), amount);
  }
  return [...unique.values()];
}

function extractBank(text: string): string | null {
  for (const [pattern, bank] of knownBanks) if (pattern.test(text)) return bank;
  const labelled = /(?:BANCO|ENTIDAD)\s*:\s*([^\r\n]{3,50})/i.exec(text)?.[1]?.trim();
  return labelled ? labelled.replace(/\s{2,}.*/, "").toUpperCase() : null;
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
  if (!local) return null;
  const shortYear = Number(local[3]);
  return validUtcDate(shortYear < 100 ? 2000 + shortYear : shortYear, Number(local[2]), Number(local[1]));
}

function extractLabel(text: string, labels: string[]): string | null {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9._/-]{3,39})`, "i");
  return pattern.exec(text)?.[1]?.trim().toUpperCase() ?? null;
}

function extractOrderingParty(text: string): string | null {
  const pattern = /(?:ORDENANTE|REMITENTE|PAGADOR|DEBITADO\s+DE)\s*:\s*([^\r\n]{3,100})/i;
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

/** Deterministic interpretation of OCR text; it does not approve or reject anything. */
export class ReceiptTextInterpreter {
  interpret(text: string, confidence: number): OcrAnalysis {
    return {
      originalText: text,
      confidence,
      detectedAmounts: extractAmounts(text),
      bank: extractBank(text),
      transactionDate: extractDate(text),
      bankReference: extractLabel(text, ["CODIGO(?:\\s+DE\\s+TRANSACCION)?", "REFERENCIA", "COMPROBANTE", "OPERACION"]),
      orderingParty: extractOrderingParty(text),
    };
  }
}
