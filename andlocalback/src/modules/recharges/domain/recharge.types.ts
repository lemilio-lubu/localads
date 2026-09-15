export enum ClientStatus { ACTIVE = "ACTIVE", INACTIVE = "INACTIVE" }
export enum AccountStatus { ACTIVE = "ACTIVE", INACTIVE = "INACTIVE" }
export enum AccountType { PREPAID = "PREPAGO", POSTPAID = "POSTPAGO" }
export enum CampaignStatus { ACTIVE = "ACTIVE", INACTIVE = "INACTIVE" }
export enum AdvertisingPlatform { META = "META", GOOGLE = "GOOGLE", TIKTOK = "TIKTOK" }
export enum PaymentStatus { PENDING = "PENDIENTE", UNDER_REVIEW = "EN_REVISION", PAID = "PAGADO", REJECTED = "RECHAZADO", ON_CREDIT = "EN_CREDITO" }
export enum RechargeStatus { PENDING_VERIFICATION = "PENDIENTE_VERIFICACION", APPROVED = "APROBADA", IN_PROCESS = "EN_PROCESO", REJECTED = "RECHAZADA" }
export enum ReceiptStatus { UPLOADED = "CARGADO", PROCESSED = "PROCESADO", FAILED = "FALLIDO" }
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

export type ReceiptVerification = {
  id: string;
  receiptId: string;
  status: VerificationStatus;
  requestedAmount: number;
  detectedAmount: number | null;
  confidence: number | null;
  amountMatches: boolean | null;
  issues: VerificationIssue[];
  requiresManualReview: boolean;
  failureReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type PaymentObligation = {
  id: string;
  amount: number;
  status: PaymentStatus.ON_CREDIT;
  dueDate: string;
  createdAt: string;
};

export type TransactionHistoryEvent = {
  id: string;
  scope: "RECARGA" | "PAGO" | "COMPROBANTE" | "VERIFICACION";
  status: string;
  note: string | null;
  createdAt: string;
};
