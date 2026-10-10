-- El crédito es dinero y no puede vivir en REAL (punto flotante binario):
-- 0.1 + 0.2 != 0.3, y sobre creditUsed se decide si una recarga POSTPAGO cabe
-- en el límite. Pasa a DECIMAL, igual que el resto de columnas monetarias.
--
-- SQLite no permite cambiar el tipo declarado de una columna: hay que recrear
-- la tabla. Los valores existentes se copian tal cual, redondeados a dos
-- decimales para descartar el ruido flotante ya acumulado.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL NOT NULL DEFAULT 0,
    "creditUsed" DECIMAL NOT NULL DEFAULT 0,
    CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Account" ("id", "clientId", "status", "type", "creditDays", "creditLimit", "creditUsed")
SELECT "id", "clientId", "status", "type", "creditDays",
       ROUND("creditLimit", 2), ROUND("creditUsed", 2)
FROM "Account";

DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";

PRAGMA foreign_keys=ON;
