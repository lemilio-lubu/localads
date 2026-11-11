-- Reintentos de autorización con espera creciente: cuántos intentos fallidos
-- seguidos lleva la factura y cuándo toca el siguiente.
ALTER TABLE "Invoice" ADD COLUMN "authorizationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "authorizationNextAttemptAt" TIMESTAMP(3);
