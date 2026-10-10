-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "Campaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receiptStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recharge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rechargeId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    CONSTRAINT "Receipt_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rechargeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAmount" REAL NOT NULL,
    "detectedAmount" REAL,
    "confidence" REAL,
    "amountMatches" BOOLEAN,
    "issues" TEXT NOT NULL,
    "requiresManualReview" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Verification_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rechargeId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionEvent_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_accountId_platform_key" ON "Campaign"("accountId", "platform");

-- CreateIndex
CREATE INDEX "Recharge_accountId_createdAt_idx" ON "Recharge"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_rechargeId_key" ON "Receipt"("rechargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_rechargeId_key" ON "Verification"("rechargeId");

-- CreateIndex
CREATE INDEX "TransactionEvent_rechargeId_createdAt_idx" ON "TransactionEvent"("rechargeId", "createdAt");
