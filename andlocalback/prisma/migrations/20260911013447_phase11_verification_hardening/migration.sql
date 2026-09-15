-- CreateTable
CREATE TABLE "ConfirmedPaymentEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "receiptChecksum" TEXT NOT NULL,
    "bankReferenceNormalized" TEXT,
    "confirmedAt" DATETIME NOT NULL,
    CONSTRAINT "ConfirmedPaymentEvidence_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConfirmedPaymentEvidence_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConfirmedPaymentEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "TransactionVerification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationDecisionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "resultingStatus" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "administratorUserId" TEXT NOT NULL,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationDecisionAudit_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "TransactionVerification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedPaymentEvidence_paymentId_key" ON "ConfirmedPaymentEvidence"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedPaymentEvidence_receiptId_key" ON "ConfirmedPaymentEvidence"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedPaymentEvidence_verificationId_key" ON "ConfirmedPaymentEvidence"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedPaymentEvidence_receiptChecksum_key" ON "ConfirmedPaymentEvidence"("receiptChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmedPaymentEvidence_bankReferenceNormalized_key" ON "ConfirmedPaymentEvidence"("bankReferenceNormalized");

-- CreateIndex
CREATE INDEX "ConfirmedPaymentEvidence_confirmedAt_idx" ON "ConfirmedPaymentEvidence"("confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDecisionAudit_verificationId_key" ON "VerificationDecisionAudit"("verificationId");

-- CreateIndex
CREATE INDEX "VerificationDecisionAudit_administratorUserId_createdAt_idx" ON "VerificationDecisionAudit"("administratorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationDecisionAudit_decision_createdAt_idx" ON "VerificationDecisionAudit"("decision", "createdAt");
