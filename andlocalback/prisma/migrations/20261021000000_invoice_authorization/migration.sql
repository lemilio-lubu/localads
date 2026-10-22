-- Autorización fiscal de la factura ante el emisor. Columnas nuevas y
-- opcionales: las facturas existentes quedan como pendientes de autorizar.
ALTER TABLE "Invoice"
  ADD COLUMN "authorizationNumber" TEXT,
  ADD COLUMN "authorizedAt" TIMESTAMP(3),
  ADD COLUMN "issuer" TEXT,
  ADD COLUMN "authorizationClaimedUntil" TIMESTAMP(3),
  ADD COLUMN "authorizationError" TEXT;

CREATE UNIQUE INDEX "Invoice_authorizationNumber_key" ON "Invoice"("authorizationNumber");
