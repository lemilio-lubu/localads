/*
  Warnings:

  - Added the required column `email` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Client` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("clientId", "id", "status", "type") SELECT "clientId", "id", "status", "type" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Client" ("id", "name", "email", "status", "createdAt", "updatedAt")
SELECT
    "id",
    CASE "id" WHEN 'client-001' THEN 'Migo Prepago' WHEN 'client-002' THEN 'Migo Postpago' ELSE "id" END,
    CASE "id" WHEN 'client-001' THEN 'prepago@andlocal.test' WHEN 'client-002' THEN 'postpago@andlocal.test' ELSE "id" || '@andlocal.test' END,
    "status",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
