# Proyecto de prueba Andlocal

Aplicación local compuesta por:

- `andlocalfront`: portal web en Next.js.
- `andlocalback`: API en NestJS con Prisma y SQLite.

## Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- Dos terminales disponibles: una para el backend y otra para el frontend.

No es necesario instalar SQLite ni levantar una base de datos externa.

## 1. Preparar y levantar el backend

Desde una terminal PowerShell ubicada en la raíz del proyecto:

```powershell
cd .\andlocalback
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

El backend queda disponible en:

- API: <http://localhost:3001/api/v1>
- Los comprobantes se consultan mediante `/api/v1/files/receipts/:receiptId/content` y requieren autenticacion; el directorio de archivos no es publico. La ruta por nombre se mantiene solo por compatibilidad temporal.

La base de datos local se crea en `andlocalback/prisma/dev.db`. El comando de seed crea cuentas PREPAGO y POSTPAGO con campañas META y GOOGLE activas.

## 2. Preparar y levantar el frontend

Sin detener el backend, abre una segunda terminal PowerShell desde la raíz:

```powershell
cd .\andlocalfront
Copy-Item .env.example .env.local -ErrorAction SilentlyContinue
npm install
npm run dev
```

Abre <http://localhost:3000> en el navegador.

## Accesos de demostración

| Perfil | Usuario | Contraseña | Sección inicial |
|---|---|---|---|
| Cliente prepago | `prepago` | `1234` | `/prepago` |
| Cliente postpago | `flex` | `1234` | `/flex` |
| Administrador | `admin` | `1234` | `/admin/clientes` |

El módulo administrativo de transacciones se encuentra en <http://localhost:3000/admin/transacciones>.

> Las credenciales anteriores son exclusivamente de demostracion. Deben sustituirse antes de publicar el sistema.

## Autenticacion

El inicio de sesion entrega un JWT de acceso de corta duracion. El frontend lo conserva solamente en memoria. El refresh token se guarda en una cookie `HttpOnly`, rota en cada renovacion y nunca se expone a JavaScript. La reutilizacion de un refresh token revocado invalida toda su familia de sesiones.

Los endpoints de cliente y administrador validan el rol y obtienen `clientId`, `accountId` y `administratorId` del JWT; no confian en identificadores enviados por el navegador.

## Puertos y variables de entorno

| Servicio | Puerto predeterminado | Variable |
|---|---:|---|
| Frontend | `3000` | Puerto predeterminado de Next.js |
| Backend | `3001` | `PORT` en `andlocalback/.env` |

Variables principales:

```dotenv
# andlocalback/.env
PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL="file:./dev.db"
JWT_ACCESS_SECRET=reemplazar-por-un-secreto-aleatorio-de-al-menos-32-caracteres
```

```dotenv
# andlocalfront/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001/transactions
NEXT_PUBLIC_PREPAID_ACCOUNT_ID=account-prepaid-001
NEXT_PUBLIC_POSTPAID_ACCOUNT_ID=account-postpaid-001
```

Si cambias un puerto, actualiza también `FRONTEND_ORIGIN` o `NEXT_PUBLIC_API_URL` según corresponda.

## Verificaciones

Backend:

```powershell
cd .\andlocalback
npm test
npm run build
```

Frontend:

```powershell
cd .\andlocalfront
npm run lint
npm run build
```

## Comandos útiles

Aplicar migraciones pendientes y volver a cargar los datos demo:

```powershell
cd .\andlocalback
npx prisma migrate deploy
npm run prisma:seed
```

Consultar si los puertos están ocupados:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3000,3001 }
```

Para detener cualquiera de los servidores iniciados en primer plano, usa `Ctrl+C` en su terminal.

## Problemas frecuentes

- **El frontend muestra errores de conexión:** confirma que el backend esté ejecutándose en el puerto `3001`.
- **El puerto ya está ocupado:** detén el proceso anterior o configura otro puerto y actualiza las variables relacionadas.
- **Prisma no reconoce cambios del esquema:** ejecuta nuevamente `npx prisma generate` y `npx prisma migrate deploy`.
- **No aparecen datos demo:** ejecuta `npm run prisma:seed` dentro de `andlocalback`.

## Verificaciones administrativas

`GET /api/v1/admin/verifications` acepta `scope=ALL|REVIEW|APPROVED|REJECTED`, busqueda, filtros y paginacion en servidor. Las decisiones generan auditoria inmutable y reservan de forma unica el checksum y la referencia bancaria normalizada.

## Actualizaciones en tiempo real

El backend expone el namespace Socket.IO `http://localhost:3001/transactions`. Los módulos de transacciones del administrador y de facturas del cliente se suscriben automáticamente; las creaciones, aprobaciones, rechazos, nuevos comprobantes y cambios a procesamiento aparecen sin recargar la página.
