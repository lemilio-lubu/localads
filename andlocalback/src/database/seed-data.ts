import { PrismaClient } from "@prisma/client";
import { scryptSync } from "node:crypto";

const demoAccounts = [
  { id: "account-prepaid-001", clientId: "client-001", type: "PREPAGO", name: "Migo Prepago", email: "prepago@andlocal.test", creditDays: 0, creditLimit: 0 },
  { id: "account-postpaid-001", clientId: "client-002", type: "POSTPAGO", name: "Migo Postpago", email: "postpago@andlocal.test", creditDays: 5, creditLimit: 10_000 },
] as const;

export async function seedBackendData(database: PrismaClient) {
  for (const account of demoAccounts) {
    await database.client.upsert({
      where: { id: account.clientId },
      update: {},
      create: { id: account.clientId, name: account.name, email: account.email, status: "ACTIVE" },
    });
    await database.account.upsert({
      where: { id: account.id },
      update: {},
      create: { id: account.id, clientId: account.clientId, status: "ACTIVE", type: account.type, creditDays: account.creditDays, creditLimit: account.creditLimit },
    });
    for (const platform of ["META", "GOOGLE"] as const) {
      await database.pauta.upsert({
        where: { clientId_platform: { clientId: account.clientId, platform } },
        update: {},
        create: { clientId: account.clientId, platform, status: "ACTIVE", activatedAt: new Date() },
      });
    }
  }
  const demoUsers = [
    { id: "auth-prepago", username: "prepago", role: "CLIENT", clientId: "client-001", accountId: "account-prepaid-001", accountType: "PREPAGO", salt: "andlocal-prepago" },
    { id: "auth-flex", username: "flex", role: "CLIENT", clientId: "client-002", accountId: "account-postpaid-001", accountType: "POSTPAGO", salt: "andlocal-flex" },
    { id: "auth-admin", username: "admin", role: "ADMIN", clientId: null, accountId: null, accountType: null, salt: "andlocal-admin" },
  ] as const;
  for (const user of demoUsers) {
    const salt = Buffer.from(user.salt); const passwordHash = `scrypt$${salt.toString("base64url")}$${scryptSync("1234", salt, 64).toString("base64url")}`;
    await database.authUser.upsert({ where: { username: user.username }, update: { role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, status: "ACTIVE" }, create: { id: user.id, username: user.username, passwordHash, role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, status: "ACTIVE" } });
  }
}
