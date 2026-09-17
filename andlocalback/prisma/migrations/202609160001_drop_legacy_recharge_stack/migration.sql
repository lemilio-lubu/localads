-- Elimina el stack de recargas v1 (una plataforma por recarga), reemplazado por
-- RechargeTransaction + TransactionDetail + Payment + PaymentReceipt +
-- TransactionVerification. Sin consumidores: el frontend usa las rutas v2.
--
-- Campaign era una proyección de solo escritura sincronizada desde Pauta, que es
-- la fuente de verdad del saldo y del estado de plataforma (INV-005).
--
-- El orden respeta las claves foráneas: hijos antes que padres.
DROP TABLE IF EXISTS "TransactionEvent";
DROP TABLE IF EXISTS "PaymentObligation";
DROP TABLE IF EXISTS "Verification";
DROP TABLE IF EXISTS "Receipt";
DROP TABLE IF EXISTS "Recharge";
DROP TABLE IF EXISTS "Campaign";
