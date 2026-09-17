export enum ClientStatus { ACTIVE = "ACTIVE", INACTIVE = "INACTIVE" }
export enum AccountStatus { ACTIVE = "ACTIVE", INACTIVE = "INACTIVE" }
export enum AccountType { PREPAID = "PREPAGO", POSTPAID = "POSTPAGO" }
export enum AdvertisingPlatform { META = "META", GOOGLE = "GOOGLE", TIKTOK = "TIKTOK" }
export enum VerificationStatus {
  UNDER_REVIEW = "EN_REVISION",
  AUTOMATICALLY_VERIFIED = "VERIFICADA_AUTOMATICAMENTE",
  APPROVED = "APROBADA",
  REJECTED = "RECHAZADA",
}
export enum VerificationIssue {
  AMOUNT_MISMATCH = "MONTO_NO_COINCIDE",
  AMOUNT_NOT_FOUND = "MONTO_NO_DETECTADO",
  LOW_CONFIDENCE = "BAJA_CONFIANZA",
  OCR_FAILURE = "FALLO_OCR",
  BANK_NOT_IDENTIFIED = "BANCO_NO_IDENTIFICADO",
  BANK_REFERENCE_NOT_IDENTIFIED = "REFERENCIA_BANCARIA_NO_IDENTIFICADA",
  DATE_OUT_OF_RANGE = "FECHA_FUERA_DE_RANGO",
  DUPLICATE_RECEIPT = "COMPROBANTE_DUPLICADO",
  DUPLICATE_BANK_REFERENCE = "REFERENCIA_BANCARIA_DUPLICADA",
}

export type StoredReceipt = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  checksum: string;
  createdAt?: string;
};

export type ReceiptUpload = {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

export type OcrResult = {
  text: string;
  confidence: number;
  detectedAmounts: number[];
  bank?: string | null;
  transactionDate?: string | null;
  bankReference?: string | null;
  orderingParty?: string | null;
};
