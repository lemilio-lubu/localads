-- Add a semantic reason for manual review without reusing rejection data.
ALTER TABLE "TransactionVerification" ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "VerificationDecisionAudit" ADD COLUMN "reviewReason" TEXT;

-- A verification now keeps every state transition. Removing only the unique
-- index preserves all existing audit rows and their identifiers.
DROP INDEX "VerificationDecisionAudit_verificationId_key";
CREATE INDEX "VerificationDecisionAudit_verificationId_createdAt_idx"
ON "VerificationDecisionAudit"("verificationId", "createdAt");
