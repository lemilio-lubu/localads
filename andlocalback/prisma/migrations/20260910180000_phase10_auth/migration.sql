CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "accountId" TEXT,
    "accountType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AuthUser_username_key" ON "AuthUser"("username");
CREATE INDEX "AuthUser_clientId_idx" ON "AuthUser"("clientId");
CREATE INDEX "AuthUser_role_status_idx" ON "AuthUser"("role", "status");

CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "replacedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");
