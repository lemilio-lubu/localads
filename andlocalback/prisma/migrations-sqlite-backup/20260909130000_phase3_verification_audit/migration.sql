-- Preserve optional administrative notes when a transaction verification is approved.
ALTER TABLE "TransactionVerification" ADD COLUMN "decisionNotes" TEXT;
