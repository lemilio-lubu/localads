-- AlterTable
ALTER TABLE "Client" ADD COLUMN "ruc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Client_ruc_key" ON "Client"("ruc");
