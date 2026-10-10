-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "accountId" TEXT,
    "accountType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "platformsVersion" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ruc" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "managerId" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditUsed" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pauta" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "status" TEXT NOT NULL,
    "currentBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pauta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignActivationRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "activeRequestKey" TEXT,
    "pautaId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ACTIVATION',
    "platform" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "phone" TEXT NOT NULL,
    "firstRechargeAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignActivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RechargeTransaction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountTypeSnapshot" TEXT NOT NULL,
    "creditDaysSnapshot" INTEGER,
    "rechargeStatus" TEXT NOT NULL DEFAULT 'REQUESTED',
    "isdRateSnapshot" DECIMAL(65,30) NOT NULL DEFAULT 0.05,
    "agencyFeeRateSnapshot" DECIMAL(65,30) NOT NULL DEFAULT 0.10,
    "vatRateSnapshot" DECIMAL(65,30) NOT NULL DEFAULT 0.15,
    "pautaAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isdAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "agencyFeeAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "vatBaseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RechargeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionDetail" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "pautaId" TEXT NOT NULL,
    "platformSnapshot" TEXT NOT NULL,
    "externalAccountSnapshot" TEXT,
    "requestedAmount" DECIMAL(65,30) NOT NULL,
    "isdAmount" DECIMAL(65,30) NOT NULL,
    "agencyFeeAmount" DECIMAL(65,30) NOT NULL,
    "vatBaseAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "effectiveRechargeAmount" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "pausedAt" TIMESTAMP(3),
    "effectiveRechargeDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLifecycleAudit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "pautaId" TEXT NOT NULL,
    "detailId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformLifecycleAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedAmount" DECIMAL(65,30) NOT NULL,
    "confirmedAmount" DECIMAL(65,30),
    "dueDate" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrResult" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "bank" TEXT,
    "detectedAmount" DECIMAL(65,30),
    "detectedDate" TIMESTAMP(3),
    "detectedTransactionCode" TEXT,
    "originator" TEXT,
    "confidence" DECIMAL(65,30),
    "rawText" TEXT,
    "failureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionVerification" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "ocrResultId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedAmount" DECIMAL(65,30) NOT NULL,
    "detectedAmount" DECIMAL(65,30),
    "amountMatches" BOOLEAN,
    "issues" TEXT NOT NULL DEFAULT '[]',
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT true,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "reviewReason" TEXT,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmedPaymentEvidence" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "receiptChecksum" TEXT NOT NULL,
    "bankReferenceNormalized" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfirmedPaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDecisionAudit" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "resultingStatus" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "administratorUserId" TEXT NOT NULL,
    "notes" TEXT,
    "reviewReason" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationDecisionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pautaSubtotal" DECIMAL(65,30) NOT NULL,
    "isdAmount" DECIMAL(65,30) NOT NULL,
    "agencyFeeAmount" DECIMAL(65,30) NOT NULL,
    "vatBaseAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "documentUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PautaBalanceMovement" (
    "id" TEXT NOT NULL,
    "pautaId" TEXT NOT NULL,
    "transactionDetailId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RECHARGE',
    "amount" DECIMAL(65,30) NOT NULL,
    "balanceBefore" DECIMAL(65,30) NOT NULL,
    "balanceAfter" DECIMAL(65,30) NOT NULL,
    "executedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PautaBalanceMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_username_key" ON "AuthUser"("username");

-- CreateIndex
CREATE INDEX "AuthUser_clientId_idx" ON "AuthUser"("clientId");

-- CreateIndex
CREATE INDEX "AuthUser_role_status_idx" ON "AuthUser"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ruc_key" ON "Client"("ruc");

-- CreateIndex
CREATE INDEX "Client_managerId_status_idx" ON "Client"("managerId", "status");

-- CreateIndex
CREATE INDEX "Pauta_clientId_status_idx" ON "Pauta"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Pauta_clientId_platform_key" ON "Pauta"("clientId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignActivationRequest_activeRequestKey_key" ON "CampaignActivationRequest"("activeRequestKey");

-- CreateIndex
CREATE INDEX "CampaignActivationRequest_clientId_platform_status_idx" ON "CampaignActivationRequest"("clientId", "platform", "status");

-- CreateIndex
CREATE INDEX "CampaignActivationRequest_status_createdAt_idx" ON "CampaignActivationRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RechargeTransaction_code_key" ON "RechargeTransaction"("code");

-- CreateIndex
CREATE INDEX "RechargeTransaction_clientId_createdAt_idx" ON "RechargeTransaction"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "RechargeTransaction_accountId_createdAt_idx" ON "RechargeTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RechargeTransaction_rechargeStatus_createdAt_idx" ON "RechargeTransaction"("rechargeStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RechargeTransaction_clientId_idempotencyKey_key" ON "RechargeTransaction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TransactionDetail_pautaId_status_idx" ON "TransactionDetail"("pautaId", "status");

-- CreateIndex
CREATE INDEX "TransactionDetail_transactionId_status_idx" ON "TransactionDetail"("transactionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionDetail_transactionId_pautaId_key" ON "TransactionDetail"("transactionId", "pautaId");

-- CreateIndex
CREATE INDEX "PlatformLifecycleAudit_clientId_createdAt_idx" ON "PlatformLifecycleAudit"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");

-- CreateIndex
CREATE INDEX "Payment_status_dueDate_idx" ON "Payment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentReceipt_paymentId_createdAt_idx" ON "PaymentReceipt"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentReceipt_checksum_idx" ON "PaymentReceipt"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "OcrResult_receiptId_key" ON "OcrResult"("receiptId");

-- CreateIndex
CREATE INDEX "OcrResult_detectedTransactionCode_idx" ON "OcrResult"("detectedTransactionCode");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionVerification_receiptId_key" ON "TransactionVerification"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionVerification_ocrResultId_key" ON "TransactionVerification"("ocrResultId");

-- CreateIndex
CREATE INDEX "TransactionVerification_status_createdAt_idx" ON "TransactionVerification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionVerification_transactionId_createdAt_idx" ON "TransactionVerification"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionVerification_paymentId_createdAt_idx" ON "TransactionVerification"("paymentId", "createdAt");

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
CREATE INDEX "VerificationDecisionAudit_administratorUserId_createdAt_idx" ON "VerificationDecisionAudit"("administratorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationDecisionAudit_decision_createdAt_idx" ON "VerificationDecisionAudit"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationDecisionAudit_verificationId_createdAt_idx" ON "VerificationDecisionAudit"("verificationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_transactionId_key" ON "Invoice"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_status_issuedAt_idx" ON "Invoice"("status", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PautaBalanceMovement_transactionDetailId_key" ON "PautaBalanceMovement"("transactionDetailId");

-- CreateIndex
CREATE INDEX "PautaBalanceMovement_pautaId_createdAt_idx" ON "PautaBalanceMovement"("pautaId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pauta" ADD CONSTRAINT "Pauta_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignActivationRequest" ADD CONSTRAINT "CampaignActivationRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignActivationRequest" ADD CONSTRAINT "CampaignActivationRequest_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargeTransaction" ADD CONSTRAINT "RechargeTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargeTransaction" ADD CONSTRAINT "RechargeTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionDetail" ADD CONSTRAINT "TransactionDetail_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionDetail" ADD CONSTRAINT "TransactionDetail_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrResult" ADD CONSTRAINT "OcrResult_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionVerification" ADD CONSTRAINT "TransactionVerification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionVerification" ADD CONSTRAINT "TransactionVerification_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionVerification" ADD CONSTRAINT "TransactionVerification_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionVerification" ADD CONSTRAINT "TransactionVerification_ocrResultId_fkey" FOREIGN KEY ("ocrResultId") REFERENCES "OcrResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmedPaymentEvidence" ADD CONSTRAINT "ConfirmedPaymentEvidence_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmedPaymentEvidence" ADD CONSTRAINT "ConfirmedPaymentEvidence_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmedPaymentEvidence" ADD CONSTRAINT "ConfirmedPaymentEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "TransactionVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecisionAudit" ADD CONSTRAINT "VerificationDecisionAudit_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "TransactionVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RechargeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaBalanceMovement" ADD CONSTRAINT "PautaBalanceMovement_pautaId_fkey" FOREIGN KEY ("pautaId") REFERENCES "Pauta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaBalanceMovement" ADD CONSTRAINT "PautaBalanceMovement_transactionDetailId_fkey" FOREIGN KEY ("transactionDetailId") REFERENCES "TransactionDetail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

