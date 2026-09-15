import { MonetaryAmount } from "../value-objects/monetary-amount";

/** Information extracted by OCR. It is evidence, never a payment decision. */
export type OcrAnalysis = {
  originalText: string;
  confidence: number;
  detectedAmounts: MonetaryAmount[];
  bank: string | null;
  transactionDate: Date | null;
  bankReference: string | null;
  orderingParty: string | null;
};

export type OcrFailure = {
  reason: string;
};
