-- Dirección y teléfono del cliente: Migo los exige al dar de alta un cliente.
ALTER TABLE "Client" ADD COLUMN "address" TEXT;
ALTER TABLE "Client" ADD COLUMN "phone" TEXT;
