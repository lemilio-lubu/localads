const { PrismaClient } = require("@prisma/client");
const { scryptSync } = require("node:crypto");

const database = new PrismaClient();
const accounts = [
  { id: "account-prepaid-001", clientId: "client-001", type: "PREPAGO", name: "Migo Prepago", email: "prepago@andlocal.test", ruc: "1712345675001", creditDays: 0, creditLimit: 0 },
  { id: "account-postpaid-001", clientId: "client-002", type: "POSTPAGO", name: "Migo Pospago", email: "pospago@andlocal.test", ruc: "0912345675001", creditDays: 5, creditLimit: 10000 },
];

async function seed() {
  for (const account of accounts) {
    await database.client.upsert({
      where: { id: account.clientId }, update: { name: account.name, email: account.email, ruc: account.ruc, status: "ACTIVE" },
      create: { id: account.clientId, name: account.name, email: account.email, ruc: account.ruc, status: "ACTIVE" },
    });
    await database.account.upsert({
      where: { id: account.id }, update: { clientId: account.clientId, status: "ACTIVE", type: account.type, creditDays: account.creditDays, creditLimit: account.creditLimit },
      create: { id: account.id, clientId: account.clientId, status: "ACTIVE", type: account.type, creditDays: account.creditDays, creditLimit: account.creditLimit },
    });
    for (const platform of ["META", "GOOGLE"]) {
      await database.pauta.upsert({
        where: { clientId_platform: { clientId: account.clientId, platform } },
        update: { status: "ACTIVE" },
        create: {
          id: `${account.clientId}-pauta-${platform.toLowerCase()}`,
          clientId: account.clientId,
          platform,
          status: "ACTIVE",
          currentBalance: 0,
          activatedAt: new Date(),
        },
      });
    }
  }
  for (const user of [
    { id: "auth-prepago", username: "prepago@andlocal.test", name: null, role: "CLIENT", clientId: "client-001", accountId: "account-prepaid-001", accountType: "PREPAGO", salt: "andlocal-prepago" },
    { id: "auth-flex", username: "pospago@andlocal.test", name: null, role: "CLIENT", clientId: "client-002", accountId: "account-postpaid-001", accountType: "POSTPAGO", salt: "andlocal-flex" },
    { id: "auth-admin", username: "admin@andlocal.test", name: "Administrador", role: "ADMIN", clientId: null, accountId: null, accountType: null, salt: "andlocal-admin" },
    { id: "auth-gestor", username: "gestor@andlocal.test", name: "Gestor de prueba", role: "GESTOR", clientId: null, accountId: null, accountType: null, salt: "andlocal-gestor" },
  ]) {
    const salt = Buffer.from(user.salt); const passwordHash = `scrypt$${salt.toString("base64url")}$${scryptSync("1234", salt, 64).toString("base64url")}`;
    await database.authUser.upsert({ where: { username: user.username }, update: { name: user.name, role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, status: "ACTIVE" }, create: { id: user.id, username: user.username, name: user.name, passwordHash, role: user.role, clientId: user.clientId, accountId: user.accountId, accountType: user.accountType, status: "ACTIVE" } });
  }
  // Un cliente con gestor y otro sin el: la demo muestra a la vez el alcance
  // del gestor y la bandeja de clientes sin asignar del admin.
  await database.client.update({ where: { id: "client-001" }, data: { managerId: "auth-gestor" } });
  console.info("Seed completado: cuentas con Pauta META/GOOGLE activas, client-001 asignado al gestor.");
}

/* El seed crea cuentas con la clave 1234 y sal fija: en una base desplegada
   serian cuatro puertas abiertas, una de ellas de administrador. Solo corre
   contra una base local salvo que se pida a proposito con ALLOW_DEMO_SEED=true
   (una demo o un staging sin datos reales). */
function assertDemoSeedAllowed(env = process.env) {
  if (env.ALLOW_DEMO_SEED === "true") return;
  const deployed = env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT);
  let host = "";
  try { host = new URL(env.DATABASE_URL ?? "").hostname; } catch { host = ""; }
  const localDatabase = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (deployed || !localDatabase) {
    throw new Error("Seed cancelado: crea cuentas demo con clave 1234 y solo corre contra una base local. Usa ALLOW_DEMO_SEED=true si de verdad es una demo.");
  }
}

try {
  assertDemoSeedAllowed();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
seed().finally(() => database.$disconnect());
