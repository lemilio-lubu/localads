-- Correct the historical backfill for the localized domain status values.
INSERT OR IGNORE INTO "ConfirmedPaymentEvidence" (
  "id", "paymentId", "receiptId", "verificationId", "receiptChecksum",
  "bankReferenceNormalized", "confirmedAt"
)
SELECT
  'evidence-' || verification."id",
  verification."paymentId",
  verification."receiptId",
  verification."id",
  receipt."checksum",
  NULLIF(
    REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(ocr."detectedTransactionCode")), ' ', ''), '-', ''), '.', ''), '/', ''),
    ''
  ),
  COALESCE(verification."decidedAt", verification."updatedAt")
FROM "TransactionVerification" verification
JOIN "PaymentReceipt" receipt ON receipt."id" = verification."receiptId"
LEFT JOIN "OcrResult" ocr ON ocr."id" = verification."ocrResultId"
WHERE verification."status" = 'APROBADA';

INSERT OR IGNORE INTO "VerificationDecisionAudit" (
  "id", "verificationId", "previousStatus", "resultingStatus", "decision",
  "administratorUserId", "notes", "rejectionReason", "createdAt"
)
SELECT
  'audit-' || verification."id",
  verification."id",
  'EN_REVISION',
  verification."status",
  CASE WHEN verification."status" = 'APROBADA' THEN 'APPROVE' ELSE 'REJECT' END,
  COALESCE(verification."decidedBy", 'migration'),
  verification."decisionNotes",
  verification."rejectionReason",
  COALESCE(verification."decidedAt", verification."updatedAt")
FROM "TransactionVerification" verification
WHERE verification."status" IN ('APROBADA', 'RECHAZADA');
