-- Facturación con Migo: el proveedor autoriza ante el SRI de forma asíncrona.
-- Columnas nuevas y opcionales: las facturas existentes no cambian.
ALTER TABLE "Invoice" ADD COLUMN "externalReference" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "fiscalNumber" TEXT;
