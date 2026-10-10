import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/* Base PostgreSQL temporal para los tests de persistencia. Cada archivo de
   test crea la suya con las migraciones reales y el seed, y la borra al
   terminar: los tests no comparten estado ni tocan la base de desarrollo.

   El servidor sale de TEST_DATABASE_URL o, si no está, de DATABASE_URL (el
   .env del backend). Solo se usa su servidor y credenciales: la base de esa
   URL no se lee ni se escribe. */
const backendRoot = resolve(__dirname, "../..");

function serverUrl() {
  const fromEnv = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const line = readFileSync(resolve(backendRoot, ".env"), "utf8").split("\n").find((entry) => entry.startsWith("DATABASE_URL="));
  if (!line) throw new Error("Los tests de persistencia necesitan TEST_DATABASE_URL o DATABASE_URL (PostgreSQL)");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

function withDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export async function createTestDatabase(prefix: string) {
  const base = serverUrl();
  if (!base.startsWith("postgres")) throw new Error(`Los tests de persistencia necesitan PostgreSQL; la URL configurada es ${base.split(":")[0]}`);
  const name = `andlocal_test_${prefix}_${process.pid}_${Date.now()}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  /* Las órdenes CREATE/DROP DATABASE se lanzan desde la base de
     mantenimiento: no se puede borrar la base a la que uno está conectado. */
  const admin = new PrismaClient({ datasourceUrl: withDatabase(base, "postgres") });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = withDatabase(base, name);
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: backendRoot, env, stdio: "pipe" });
  /* Con el seed, el punto de partida es el que tenían los tests cuando
     copiaban dev.db: usuarios demo (auth-admin, auth-gestor…), clientes y
     pautas. Los tests crean además sus propios datos con identificadores
     únicos. */
  execFileSync("npx", ["prisma", "db", "seed"], { cwd: backendRoot, env, stdio: "pipe" });
  return {
    url,
    async drop() {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
