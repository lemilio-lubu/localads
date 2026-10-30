-- Referencia de pago estable por cliente. La columna nace nula y se rellena con
-- un derivado del id (AND- + 8 hex en mayusculas); no es UNIQUE, asi que un
-- choque improbable no puede fallar el despliegue.
ALTER TABLE "Client" ADD COLUMN "paymentReference" TEXT;
UPDATE "Client" SET "paymentReference" = 'AND-' || upper(substr(md5("id"), 1, 8)) WHERE "paymentReference" IS NULL;

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderTaxId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccountAudit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAccountAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAccount_active_position_idx" ON "PaymentAccount"("active", "position");

-- CreateIndex
CREATE INDEX "PaymentAccountAudit_accountId_createdAt_idx" ON "PaymentAccountAudit"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentAccountAudit" ADD CONSTRAINT "PaymentAccountAudit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
