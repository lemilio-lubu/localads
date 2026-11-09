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

El servicio del backend debe usar `andlocalback` como **Root Directory**. La configuración del despliegue vive en la interfaz de Railway, no en el repositorio: el servicio nunca usó un archivo de configuración (*config as code*), Railway ya no deja activarlo en servicios nuevos y lo retira el 2026-12-01. Por eso no hay `railway.json`. En **Settings** del servicio:

| Ajuste | Valor | Para qué |
|---|---|---|
| Build | Railpack, sin comando propio | ejecuta `npm run build` (`prisma generate` + `nest build`) |
| Start Command | vacío | Railpack ejecuta `npm start` (`node dist/main.js`) |
| Pre-deploy Command | `npm run db:migrate` | aplica `prisma migrate deploy` antes de cada despliegue; si falla, el despliegue se aborta y sigue el anterior |
| Healthcheck Path | `/api/v1/health` | el tráfico solo pasa a la versión nueva cuando responde 200 |

Sin el pre-deploy, una migración nueva llega a producción sin aplicarse y la API falla hasta que alguien la ejecute a mano.

Añade un servicio PostgreSQL al proyecto y crea en el servicio backend estas variables:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
JWT_ACCESS_SECRET=<secreto aleatorio de al menos 32 caracteres>
MFA_ENCRYPTION_KEY=<openssl rand -base64 32>
FRONTEND_ORIGIN=https://<dominio-del-frontend>
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET=<nombre-del-bucket>
R2_REGION=auto
```

La API no arranca en un despliegue (`NODE_ENV=production` o cualquier entorno de Railway) si `JWT_ACCESS_SECRET` tiene menos de 32 caracteres o es el de ejemplo, si falta `DATABASE_URL`, si `FRONTEND_ORIGIN` no es un único origen `https` o si `MFA_ENCRYPTION_KEY` no es una clave de 32 bytes en base64.

`MFA_ENCRYPTION_KEY` cifra los secretos del doble factor guardados en la base. Va aparte de `JWT_ACCESS_SECRET` a propósito: rotar el secreto JWT solo cierra sesiones, mientras que perder o cambiar esta clave deja inservible el doble factor de quien lo tenga activo (un admin se lo restablece desde Equipo y la persona lo activa de nuevo). Guárdala también fuera de Railway.

## Sesiones y doble factor

- El doble factor (TOTP: Google Authenticator, Microsoft Authenticator, 1Password…) es opcional para todos. Cada persona lo activa o lo quita desde «Cambiar contraseña»; al activarlo recibe 10 códigos de recuperación de un solo uso. Al equipo (admin y gestor) se le sugiere al entrar mientras no lo tenga. Con él activo, la contraseña sola no abre sesión.
- Sesión del equipo: 12 h como máximo y 30 min de inactividad. Clientes: 7 días y 1 día.
- Cinco intentos fallidos (clave o código) bloquean la cuenta 15 min, el doble con cada fallo posterior hasta un día. Restablecer la clave desde Equipo o Clientes la desbloquea.
- Dar de baja, cambiar el rol o restablecer la clave corta el acceso en menos de 30 s, también en el tiempo real.

Variables opcionales de seguridad:

```dotenv
# Proxies delante de la API; por defecto 1 en un despliegue (el borde de Railway) y 0 en local
TRUST_PROXY_HOPS=1
# Solicitudes por minuto y usuario (o IP sin sesión); por defecto 600
RATE_LIMIT_PER_MINUTE=600
# Intentos de login por minuto para cada IP y correo; por defecto 10
LOGIN_RATE_LIMIT_PER_MINUTE=10
```

## Logs y auditoría de seguridad

- Cada línea del log es un JSON (pino) con `requestId` y, si la petición ya está autenticada, `userId`. El `requestId` vuelve en la cabecera `X-Request-Id` y en el cuerpo de cualquier 500: con él se encuentra el detalle del error en los logs de Railway.
- Por petición se registran método, ruta (sin query), estado, duración, IP y user-agent; nunca cabeceras ni cuerpo. Claves, tokens, cookies y referencias bancarias se tapan aunque algún servicio los pase. De los errores de Prisma se guarda el código, no el mensaje (copia los argumentos de la consulta).
- Un error no controlado responde `500 { code: "INTERNAL_ERROR", requestId }` con un mensaje genérico; el detalle queda solo en el servidor.
- `SecurityAuditEvent` registra accesos (login correcto y fallido, bloqueo, cierre de sesión, reutilización de refresh), doble factor, cambios de clave, altas, ediciones y bajas del equipo y de clientes, cambios de rol, reasignación de cartera y apertura de comprobantes. Es de solo inserción: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`. No guarda claves, códigos, el correo tecleado en un login fallido ni valores de RUC o correo, solo los nombres de los campos que cambiaron.
- El admin lo consulta en el portal, en **Auditoría de seguridad** del menú de perfil (`GET /api/v1/admin/security-events`), con filtros por tipo y por resultado. Se puede buscar por persona, por cliente o por el código de referencia de 8 caracteres que muestra un error 500.

```dotenv
# Nivel del log: fatal, error, warn, info (por defecto), debug, trace o silent
LOG_LEVEL=info
```

El seed (`npm run prisma:seed`) crea las cuentas demo con clave `1234` y se niega a correr si el entorno es un despliegue o la base no es local. Para una demo sin datos reales se puede forzar con `ALLOW_DEMO_SEED=true`.

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

## Facturación electrónica (Migo)

Al completarse una recarga se crea su factura y se pide la autorización al emisor configurado en `INVOICE_ISSUER`:

| Valor | Uso |
|---|---|
| `simulado` | Desarrollo. Autoriza al instante con un PDF marcado «sin validez tributaria». Es el valor por defecto fuera de producción. |
| `desactivado` | Las facturas quedan pendientes y se autorizan solas cuando se configura un emisor. Es el valor por defecto en producción. |
| `migo` | Emisión real ante el SRI a través de la [API de Migo](https://apidocs.migo.com.ec). |

Con `migo`:

- Una línea por plataforma con la base completa (pauta + ISD + comisión) y su IVA, con el producto de esa plataforma («Servicio de Intermediación por Pauta Meta/Google/TikTok»), igual que las facturas que AND ya emitía a mano en Migo. Así el IVA que Migo recalcula línea a línea coincide al centavo con el cobrado. El desglose va en la información adicional de la factura.
- Si el cliente no existe en Migo (se busca por RUC), se da de alta.
- Migo responde `SENT_TO_SRI` y autoriza después: se guardan su id (`Invoice.externalReference`) y el número fiscal (`Invoice.fiscalNumber`), y el reintento de cada minuto consulta esa factura en vez de emitir otra. El `invoiceUuid` se deriva del número interno, así que un reintento tras una respuesta perdida manda el mismo.
- Un rechazo del SRI queda en `Invoice.authorizationError` y la factura se sigue consultando por si se corrige en Migo.
- Si falta configuración, el backend no arranca y el error lista todo lo que falta.
- **Corte:** la facturación electrónica empieza con la migración `20261109000000_facturas_anteriores_a_migo`. Las facturas que seguían sin autorizar al aplicarla quedan en estado `MANUAL` («facturada a mano por AND»): el emisor no las toma nunca y, si hacen falta, AND las factura por su cuenta.
- La API de Migo no entrega el PDF: el portal genera el RIDE (`infrastructure/services/invoice-pdf.ts`) con el logo de AND, el azul y el orden del RIDE de Migo, la clave de acceso con su código de barras Code 128 y los datos del emisor de `and-emitter.ts`. Esos datos son fijos y deben coincidir con los de Migo; si cambian, se cambian en los dos sitios. El código de cada línea sale de `MIGO_PRODUCT_CODE_*`: sin él, la columna «Cód.» queda vacía.

**La cuenta de Migo de AND es la real: no hay entorno de pruebas.** Con `INVOICE_ISSUER=migo`, cada factura llega al SRI; en desarrollo se usa `simulado`.

Variables (los ids salen del catálogo de la empresa en Migo: `/api/v1/emission-points/options`, `/api/v1/products?establishmentId=`, `/api/v1/taxes/options`, `/api/v1/identification-types/options`, `/api/v1/customer-groups/options`, `/api/v1/payment-methods/options?module=INVOICE`, `/api/v1/payment-terms/options`):

| Variable | Obligatoria | Qué es | Valor de AND |
|---|---|---|---|
| `MIGO_CLIENT_ID`, `MIGO_CLIENT_SECRET` | Sí | Credencial de «Seguridad > Credenciales API» con permisos `SALES_INVOICE:CREATE`/`READ` y `CUSTOMER:READ`/`CREATE` | (secreto) |
| `MIGO_EMISSION_POINT_ID` | Sí | Punto de emisión | `32739` (ELECTRONICO, 001) |
| `MIGO_PRODUCT_ID_META`, `_GOOGLE`, `_TIKTOK` | Sí | Producto de cada plataforma, con IVA 15 % | `6644066`, `6644062`, `6644068` |
| `MIGO_PRODUCT_CODE_META`, `_GOOGLE`, `_TIKTOK` | No | Código del producto (`referenceCode`) | `05`, `04`, `06` |
| `MIGO_VAT_TAX_ID` | Sí | Id del IVA 15 % (el mismo de los productos) | `10` |
| `MIGO_RUC_IDENTIFICATION_TYPE_ID` | Sí | Tipo de identificación RUC, para dar de alta clientes | `1` |
| `MIGO_CUSTOMER_GROUP_ID` | Sí | Grupo de cliente para las altas | `25319` (FINALES) |
| `MIGO_VENDOR_ID` | No | Vendedor de la factura | `27865` (el de las facturas actuales) |
| `MIGO_ACTIVITY_ID` | No | Actividad económica, si la empresa la exige | — |
| `MIGO_BASE_URL` | No | Por defecto `https://api.migo.com.ec`; admite `http://localhost` para un emulador | — |
| `MIGO_PREPAID_PAYMENT_METHOD_ID`, `MIGO_CREDIT_PAYMENT_METHOD_ID` | No, los dos o ninguno | Forma de pago de prepago y de pospago | Sin definir: las facturas actuales no registran forma de pago (existen `6` Transferencia y `8` Cliente (Crédito)) |
| `MIGO_CREDIT_PAYMENT_TERM_ID` | No | Plazo de crédito del pospago | `21297` (Crédito 30 días), si se definen las formas de pago |
| `MIGO_TIMEOUT_MS` | No | Tiempo máximo por petición; por defecto 15000 | — |

Las pruebas `test/migo-invoicing.integration.spec.ts` recorren el flujo completo contra un emulador de la API (`test/support/fake-migo-server.ts`).

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
