-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "push" SET DEFAULT true;
