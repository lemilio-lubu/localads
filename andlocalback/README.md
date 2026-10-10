# Andlocal Back

API NestJS para recargas PREPAGO y POSTPAGO, organizada con Clean Architecture.

## Desarrollo

```bash
npm install
npm run start:dev
```

La API escucha en `http://localhost:3001/api/v1` y acepta el frontend en `http://localhost:3000`.

La persistencia usa Prisma con PostgreSQL. Configura `DATABASE_URL` en `.env` con una URL PostgreSQL local o de Railway. Las migraciones de PostgreSQL están en `prisma/migrations`; las migraciones históricas de SQLite se conservaron en `prisma/migrations-sqlite-backup` y no se ejecutan en PostgreSQL. El proceso del backend ya no inserta usuarios ni datos demo al iniciar; carga esos datos sólo con `npm run prisma:seed` cuando sea necesario.

```bash
npm run prisma:deploy
npm run prisma:seed
```

### Tests

```bash
npm test && npm run typecheck && npm run build
```

Los tests de persistencia necesitan un servidor PostgreSQL: toman su dirección de `TEST_DATABASE_URL` o, si no existe, de `DATABASE_URL`. Cada archivo de test crea una base temporal propia (`andlocal_test_…`) con las migraciones y el seed, y la borra al terminar; la base de esa URL no se lee ni se escribe. El usuario necesita permiso para crear bases de datos (`CREATEDB`).

La migración inicial crea el esquema, pero no copia automáticamente los datos de `prisma/dev.db`. Ese archivo y un respaldo fechado se conservan localmente; el respaldo está excluido de Git para no publicar datos potencialmente sensibles. Los comprobantes de `uploads/` tampoco se han migrado a almacenamiento remoto.

## Despliegue en Railway

El servicio del backend debe usar `andlocalback` como **Root Directory** y `/andlocalback/railway.json` como archivo de configuración Railway. El archivo configura la compilación, ejecuta `prisma migrate deploy` antes de publicar y arranca la API. Añade un servicio PostgreSQL al proyecto y crea en el servicio backend estas variables:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
JWT_ACCESS_SECRET=<secreto aleatorio de al menos 32 caracteres>
FRONTEND_ORIGIN=https://<dominio-del-frontend>
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET=<nombre-del-bucket>
R2_REGION=auto
```

En Cloudflare R2 crea un bucket privado y un token **Object Read & Write** limitado a ese bucket. El backend usa el endpoint S3 `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; no hace falta exponer el bucket públicamente porque las descargas pasan por la API autenticada. Guarda el secreto únicamente en Railway. La comprobación de salud está en `/api/v1/health`.

No ejecutes `npm run prisma:seed` en producción: crea cuentas demo con contraseñas conocidas. Para crear el primer administrador, agrega temporalmente `BOOTSTRAP_ADMIN_USERNAME` y `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 12 caracteres) al servicio, ejecuta `npm run bootstrap:admin` desde la consola del servicio y elimina esas dos variables inmediatamente. El comando solo crea el usuario cuando la tabla de usuarios está vacía y nunca modifica cuentas existentes.

Los comprobantes nuevos se guardan en R2 y PostgreSQL almacena el identificador `r2://...`, junto con tipo, tamaño y checksum. Las filas antiguas que apuntan a `/uploads/receipts/...` necesitan que esos archivos se copien a R2 antes de abandonar el servidor donde se subieron: los archivos del disco local no se transfieren solos.

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
