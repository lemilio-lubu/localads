const { randomBytes, scryptSync } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const database = new PrismaClient();

async function bootstrapAdmin() {
  /* El administrador entra con su correo, como todos. La variable conserva su nombre para no romper los despliegues que ya la tienen. */
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) throw new Error("BOOTSTRAP_ADMIN_USERNAME debe ser un correo válido");
  if (!password || password.length < 12) throw new Error("BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 12 caracteres");

  const existingUsers = await database.authUser.count();
  if (existingUsers > 0) throw new Error("Bootstrap cancelado: la base ya tiene usuarios");

  const salt = randomBytes(16);
  const passwordHash = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
  await database.authUser.create({
    data: { username, passwordHash, role: "ADMIN", status: "ACTIVE" },
  });
  console.info("Administrador inicial creado. Elimina las variables BOOTSTRAP_ADMIN_* del servicio.");
}

bootstrapAdmin()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => database.$disconnect());
