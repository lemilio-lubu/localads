ALTER TABLE "Client" ADD COLUMN "platformsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampaignActivationRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ACTIVATION';
DROP INDEX "CampaignActivationRequest_pautaId_key";
ALTER TABLE "TransactionDetail" ADD COLUMN "pausedAt" DATETIME;
CREATE TABLE "PlatformLifecycleAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "pautaId" TEXT NOT NULL,
  "detailId" TEXT,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformLifecycleAudit_clientId_createdAt_idx" ON "PlatformLifecycleAudit"("clientId", "createdAt");
