-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "dueSoonRemindedAt" TIMESTAMP(3),
ADD COLUMN     "dueTodayRemindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailDailyUsage" (
    "day" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "quotaAlertedAt" TIMESTAMP(3),
    "failuresAlertedAt" TIMESTAMP(3),

    CONSTRAINT "EmailDailyUsage_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "Notification_emailRetryAt_idx" ON "Notification"("emailRetryAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
