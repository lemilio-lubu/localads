# Andlocal Back

API NestJS para recargas PREPAGO y POSTPAGO, organizada con Clean Architecture.

## Desarrollo

```bash
npm install
npm run start:dev
```

La API escucha en `http://localhost:3001/api/v1` y acepta el frontend en `http://localhost:3000`.

La persistencia usa Prisma con SQLite. La migración inicial está versionada en `prisma/migrations` y la base local se crea con:

```bash
npm run prisma:migrate
npm run prisma:seed
```

## Cuentas de demostración

- PREPAGO: `account-prepaid-001`
- POSTPAGO: `account-postpaid-001`
- Ambas están activas y tienen pautas META y GOOGLE activas.

## Recarga PREPAGO y OCR

`POST /api/v1/prepaid-recharges` recibe `multipart/form-data` con:

- `accountId`
- `platform`: `META`, `GOOGLE` o `TIKTOK`
- `amount`
- `receipt`: PNG, JPG, WEBP o PDF de máximo 5 MB

El archivo original se almacena antes de procesar el OCR. Para imágenes, Tesseract extrae el texto, la confianza y los posibles montos. La respuesta inicial siempre mantiene:

- `paymentStatus: "EN_REVISION"`
- `status: "PENDIENTE_VERIFICACION"`
- `canTransitionToProcessing: false`

La propiedad `verification` informa `detectedAmount`, `amountMatches`, `confidence`, `issues` y `requiresManualReview`. El umbral mínimo de confianza es 80.

Tesseract.js no procesa PDF directamente. Los PDF sí se reciben y conservan, pero quedan con `receiptStatus: "FALLIDO"`, inconsistencia `FALLO_OCR` y revisión manual disponible.

`PATCH /api/v1/recharges/:id/verification/approve` representa la aprobación manual. Sólo entonces el pago pasa a `PAGADO`, la recarga a `APROBADA` y se habilita la transición a procesamiento.

## Recarga POSTPAGO

`POST /api/v1/postpaid-recharges` recibe JSON con `accountId`, `platform` y `amount`. No requiere comprobante, valida el cupo disponible, crea una obligación y responde con pago `EN_CREDITO` y recarga `APROBADA`.

`PATCH /api/v1/recharges/:id/processing` cambia una recarga elegible a `EN_PROCESO`.

`GET /api/v1/transactions?accountId=:accountId` devuelve las transacciones persistidas de la cuenta, incluyendo comprobante, resultado OCR e historial cronológico. Este endpoint alimenta el módulo Facturas del frontend.

## Administración de clientes

El módulo administrativo usa las siguientes operaciones persistidas con Prisma:

- `GET /api/v1/admin/clients`
- `GET /api/v1/admin/clients/:id`
- `POST /api/v1/admin/clients`
- `PATCH /api/v1/admin/clients/:id`
- `DELETE /api/v1/admin/clients/:id` (desactivación lógica)

Crear un cliente genera exactamente una cuenta PREPAGO o POSTPAGO y sus pautas activas en una única transacción. La desactivación conserva las recargas históricas.

El tipo de cuenta se guarda como instantánea dentro de cada recarga; cambiarlo después no altera transacciones existentes.

## WebSockets

El namespace Socket.IO `/transactions` publica `transaction:changed` cuando una transacción se crea o cambia. Los consumidores se registran mediante `transactions:subscribe`, usando `{ "scope": "admin" }` para administración o `{ "accountId": "..." }` para una cuenta concreta.
