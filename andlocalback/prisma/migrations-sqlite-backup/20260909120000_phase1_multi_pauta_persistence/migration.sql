-- Additive persistence for the multi-pauta recharge flow.
-- Legacy recharge tables are intentionally left unchanged during migration.

CREATE TABLE "Pauta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "status" TEXT NOT NULL,
    "currentBalance" DECIMAL NOT NULL DEFAULT 0,
    "activatedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pauta_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CampaignActivationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "pautaId" TEXT,
    "platform" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "phone" TEXT NOT NULL,
    "firstRechargeAmount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignActivationRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CampaignActivationRequest_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RechargeTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountTypeSnapshot" TEXT NOT NULL,
    "creditDaysSnapshot" INTEGER,
    "rechargeStatus" TEXT NOT NULL DEFAULT 'REQUESTED',
    "isdRateSnapshot" DECIMAL NOT NULL DEFAULT 0.05,
    "agencyFeeRateSnapshot" DECIMAL NOT NULL DEFAULT 0.10,
    "vatRateSnapshot" DECIMAL NOT NULL DEFAULT 0.15,
    "pautaAmount" DECIMAL NOT NULL DEFAULT 0,
    "isdAmount" DECIMAL NOT NULL DEFAULT 0,
    "agencyFeeAmount" DECIMAL NOT NULL DEFAULT 0,
    "vatBaseAmount" DECIMAL NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RechargeTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RechargeTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TransactionDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "pautaId" TEXT NOT NULL,
    "platformSnapshot" TEXT NOT NULL,
    "externalAccountSnapshot" TEXT,
    "requestedAmount" DECIMAL NOT NULL,
    "isdAmount" DECIMAL NOT NULL,
    "agencyFeeAmount" DECIMAL NOT NULL,
    "vatBaseAmount" DECIMAL NOT NULL,
    "vatAmount" DECIMAL NOT NULL,
    "totalAmount" DECIMAL NOT NULL,
    "effectiveRechargeAmount" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "effectiveRechargeDate" DATETIME,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransactionDetail_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionDetail_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedAmount" DECIMAL NOT NULL,
    "confirmedAmount" DECIMAL,
    "dueDate" DATETIME,
    "confirmedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OcrResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    "bank" TEXT,
    "detectedAmount" DECIMAL,
    "detectedDate" DATETIME,
    "detectedTransactionCode" TEXT,
    "originator" TEXT,
    "confidence" DECIMAL,
    "rawText" TEXT,
    "failureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcrResult_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TransactionVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "ocrResultId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedAmount" DECIMAL NOT NULL,
    "detectedAmount" DECIMAL,
    "amountMatches" BOOLEAN,
    "issues" TEXT NOT NULL DEFAULT '[]',
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT true,
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransactionVerification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionVerification_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionVerification_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionVerification_ocrResultId_fkey" FOREIGN KEY ("ocrResultId") REFERENCES "OcrResult" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pautaSubtotal" DECIMAL NOT NULL,
    "isdAmount" DECIMAL NOT NULL,
    "agencyFeeAmount" DECIMAL NOT NULL,
    "vatBaseAmount" DECIMAL NOT NULL,
    "vatAmount" DECIMAL NOT NULL,
    "totalAmount" DECIMAL NOT NULL,
    "documentUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PautaBalanceMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pautaId" TEXT NOT NULL,
    "transactionDetailId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RECHARGE',
    "amount" DECIMAL NOT NULL,
    "balanceBefore" DECIMAL NOT NULL,
    "balanceAfter" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PautaBalanceMovement_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PautaBalanceMovement_transactionDetailId_fkey" FOREIGN KEY ("transactionDetailId") REFERENCES "TransactionDetail" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Pauta_clientId_status_idx" ON "Pauta"("clientId", "status");
CREATE UNIQUE INDEX "Pauta_clientId_platform_key" ON "Pauta"("clientId", "platform");
CREATE INDEX "CampaignActivationRequest_clientId_platform_status_idx" ON "CampaignActivationRequest"("clientId", "platform", "status");
CREATE INDEX "CampaignActivationRequest_status_createdAt_idx" ON "CampaignActivationRequest"("status", "createdAt");
CREATE UNIQUE INDEX "CampaignActivationRequest_pautaId_key" ON "CampaignActivationRequest"("pautaId");
CREATE UNIQUE INDEX "RechargeTransaction_code_key" ON "RechargeTransaction"("code");
CREATE UNIQUE INDEX "RechargeTransaction_clientId_idempotencyKey_key" ON "RechargeTransaction"("clientId", "idempotencyKey");
CREATE INDEX "RechargeTransaction_clientId_createdAt_idx" ON "RechargeTransaction"("clientId", "createdAt");
CREATE INDEX "RechargeTransaction_accountId_createdAt_idx" ON "RechargeTransaction"("accountId", "createdAt");
CREATE INDEX "RechargeTransaction_rechargeStatus_createdAt_idx" ON "RechargeTransaction"("rechargeStatus", "createdAt");
CREATE INDEX "TransactionDetail_pautaId_status_idx" ON "TransactionDetail"("pautaId", "status");
CREATE INDEX "TransactionDetail_transactionId_status_idx" ON "TransactionDetail"("transactionId", "status");
CREATE UNIQUE INDEX "TransactionDetail_transactionId_pautaId_key" ON "TransactionDetail"("transactionId", "pautaId");
CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");
CREATE INDEX "Payment_status_dueDate_idx" ON "Payment"("status", "dueDate");
CREATE INDEX "PaymentReceipt_paymentId_createdAt_idx" ON "PaymentReceipt"("paymentId", "createdAt");
CREATE INDEX "PaymentReceipt_checksum_idx" ON "PaymentReceipt"("checksum");
CREATE UNIQUE INDEX "OcrResult_receiptId_key" ON "OcrResult"("receiptId");
CREATE INDEX "OcrResult_detectedTransactionCode_idx" ON "OcrResult"("detectedTransactionCode");
CREATE UNIQUE INDEX "TransactionVerification_receiptId_key" ON "TransactionVerification"("receiptId");
CREATE UNIQUE INDEX "TransactionVerification_ocrResultId_key" ON "TransactionVerification"("ocrResultId");
CREATE INDEX "TransactionVerification_status_createdAt_idx" ON "TransactionVerification"("status", "createdAt");
CREATE INDEX "TransactionVerification_transactionId_createdAt_idx" ON "TransactionVerification"("transactionId", "createdAt");
CREATE INDEX "TransactionVerification_paymentId_createdAt_idx" ON "TransactionVerification"("paymentId", "createdAt");
CREATE UNIQUE INDEX "Invoice_transactionId_key" ON "Invoice"("transactionId");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_status_issuedAt_idx" ON "Invoice"("status", "issuedAt");
CREATE UNIQUE INDEX "PautaBalanceMovement_transactionDetailId_key" ON "PautaBalanceMovement"("transactionDetailId");
CREATE INDEX "PautaBalanceMovement_pautaId_createdAt_idx" ON "PautaBalanceMovement"("pautaId", "createdAt");
