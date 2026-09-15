PRAGMA foreign_keys=OFF;

ALTER TABLE "Account" ADD COLUMN "creditLimit" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "creditUsed" REAL NOT NULL DEFAULT 0;

CREATE TABLE "new_Receipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rechargeId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Receipt_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Receipt" ("id", "rechargeId", "originalName", "mimeType", "size", "url", "checksum")
SELECT "id", "rechargeId", "originalName", "mimeType", "size", "url", "checksum" FROM "Receipt";
DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE INDEX "Receipt_rechargeId_createdAt_idx" ON "Receipt"("rechargeId", "createdAt");

CREATE TABLE "new_Verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rechargeId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedAmount" REAL NOT NULL,
  "detectedAmount" REAL,
  "confidence" REAL,
  "amountMatches" BOOLEAN,
  "issues" TEXT NOT NULL,
  "requiresManualReview" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "decidedBy" TEXT,
  "decidedAt" DATETIME,
  "rejectionReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Verification_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Verification" ("id", "rechargeId", "receiptId", "status", "requestedAmount", "detectedAmount", "confidence", "amountMatches", "issues", "requiresManualReview", "failureReason", "createdAt")
SELECT v."id", v."rechargeId", r."id", v."status", v."requestedAmount", v."detectedAmount", v."confidence", v."amountMatches", v."issues", v."requiresManualReview", v."failureReason", v."createdAt"
FROM "Verification" v JOIN "Receipt" r ON r."rechargeId" = v."rechargeId";
DROP TABLE "Verification";
ALTER TABLE "new_Verification" RENAME TO "Verification";
CREATE INDEX "Verification_rechargeId_createdAt_idx" ON "Verification"("rechargeId", "createdAt");
CREATE UNIQUE INDEX "Verification_receiptId_key" ON "Verification"("receiptId");

CREATE TABLE "PaymentObligation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rechargeId" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "status" TEXT NOT NULL,
  "dueDate" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentObligation_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "Recharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentObligation_rechargeId_key" ON "PaymentObligation"("rechargeId");

PRAGMA foreign_keys=ON;
