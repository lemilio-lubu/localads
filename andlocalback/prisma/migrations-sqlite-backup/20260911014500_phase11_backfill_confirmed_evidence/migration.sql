-- Preserve evidence and decisions confirmed before the Phase 11 constraints existed.
INSERT INTO "ConfirmedPaymentEvidence" (
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
WHERE verification."status" = 'APPROVED';

INSERT INTO "VerificationDecisionAudit" (
  "id", "verificationId", "previousStatus", "resultingStatus", "decision",
  "administratorUserId", "notes", "rejectionReason", "createdAt"
)
SELECT
  'audit-' || verification."id",
  verification."id",
  'EN_REVISION',
  verification."status",
  CASE WHEN verification."status" = 'APPROVED' THEN 'APPROVE' ELSE 'REJECT' END,
  COALESCE(verification."decidedBy", 'migration'),
  verification."decisionNotes",
  verification."rejectionReason",
  COALESCE(verification."decidedAt", verification."updatedAt")
FROM "TransactionVerification" verification
WHERE verification."status" IN ('APPROVED', 'REJECTED');
