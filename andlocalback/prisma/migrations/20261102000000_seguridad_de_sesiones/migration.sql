-- Fase 1 del hardening: revocacion inmediata, bloqueo por intentos, doble
-- factor y tope absoluto de sesion. Todo son columnas nuevas con valor por
-- defecto: ninguna fila existente cambia de significado.
ALTER TABLE "AuthUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthUser" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthUser" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "AuthUser" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "AuthUser" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "AuthUser" ADD COLUMN "mfaLastStep" INTEGER;
ALTER TABLE "AuthUser" ADD COLUMN "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Las sesiones abiertas antes de esto toman la fecha de su token actual como
-- inicio: no hay otra, y el cambio de nombre de la cookie las cierra igual.
ALTER TABLE "RefreshSession" ADD COLUMN "familyCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "RefreshSession" SET "familyCreatedAt" = "createdAt";
