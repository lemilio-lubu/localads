-- Tres roles: CLIENT, GESTOR y ADMIN. El rol sigue siendo TEXT porque SQLite
-- no tiene enums y el resto del esquema ya guarda estados como texto; el tipo
-- fuerte vive en AuthRole.
--
-- Client.managerId es el gestor responsable. Nulo significa "sin asignar", que
-- es el estado que el admin reasigna, y es donde quedan los clientes de un
-- gestor dado de baja: el ON DELETE SET NULL del FK lo garantiza incluso si
-- algun dia se borrara ese usuario.
--
-- AuthUser.mustChangePassword sostiene la clave temporal: se muestra una sola
-- vez al crear la cuenta y el usuario esta obligado a cambiarla al entrar.
--
-- SQLite no permite anadir un FK a una tabla existente, asi que ambas tablas
-- se recrean y se copian los datos. Ninguna fila cambia de significado: las
-- columnas nuevas entran nulas o con su valor por defecto.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuthUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "accountId" TEXT,
    "accountType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AuthUser" ("accountId", "accountType", "clientId", "createdAt", "id", "passwordHash", "role", "status", "updatedAt", "username") SELECT "accountId", "accountType", "clientId", "createdAt", "id", "passwordHash", "role", "status", "updatedAt", "username" FROM "AuthUser";
DROP TABLE "AuthUser";
ALTER TABLE "new_AuthUser" RENAME TO "AuthUser";
CREATE UNIQUE INDEX "AuthUser_username_key" ON "AuthUser"("username");
CREATE INDEX "AuthUser_clientId_idx" ON "AuthUser"("clientId");
CREATE INDEX "AuthUser_role_status_idx" ON "AuthUser"("role", "status");
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformsVersion" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "managerId" TEXT,
    CONSTRAINT "Client_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "AuthUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("createdAt", "email", "id", "name", "platformsVersion", "status", "updatedAt") SELECT "createdAt", "email", "id", "name", "platformsVersion", "status", "updatedAt" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");
CREATE INDEX "Client_managerId_status_idx" ON "Client"("managerId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
