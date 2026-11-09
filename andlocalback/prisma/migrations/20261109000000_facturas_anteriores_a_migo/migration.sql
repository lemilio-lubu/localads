-- La facturación electrónica con Migo empieza con esta versión. Las facturas
-- que siguen sin autorizar son de recargas anteriores: AND las factura a mano
-- si hace falta, así que el emisor no debe tomarlas nunca.
-- Solo las que nunca llegaron a un proveedor (sin referencia externa).
UPDATE "Invoice"
SET "status" = 'MANUAL',
    "authorizationClaimedUntil" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ISSUED'
  AND "authorizationNumber" IS NULL
  AND "externalReference" IS NULL;

-- Dos de ellas AND ya las facturó a mano en Migo (comprobado el 2026-11-08
-- contra su API: mismo cliente y mismo total). Se guarda su número fiscal
-- para que se vea en la recarga. En otras bases no existen y no cambia nada.
UPDATE "Invoice" SET "fiscalNumber" = '001-001-000000608', "updatedAt" = CURRENT_TIMESTAMP
WHERE "invoiceNumber" = 'FAC-TX-760444e5-0b64-4c9c-a53d-3d9d462ece3c' AND "status" = 'MANUAL' AND "fiscalNumber" IS NULL;
UPDATE "Invoice" SET "fiscalNumber" = '001-001-000000653', "updatedAt" = CURRENT_TIMESTAMP
WHERE "invoiceNumber" = 'FAC-TX-d9a018d7-fb79-4179-b83d-ce41822ae4aa' AND "status" = 'MANUAL' AND "fiscalNumber" IS NULL;
