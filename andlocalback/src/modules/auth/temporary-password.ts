import { randomInt } from "node:crypto";

/* Alfabeto sin caracteres que se confunden al dictar por telefono o al copiar
   a mano: nada de 0/O, 1/l/I ni 5/S. La clave se entrega fuera del sistema,
   asi que tiene que poder leerse en voz alta sin ambiguedad. */
const alphabet = "ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrstuvwxyz2346789";
const length = 12;

/* randomInt del modulo crypto, no Math.random: es la unica fuente que no es
   predecible desde fuera, y descarta el sesgo del modulo por si sola. */
export function generateTemporaryPassword(): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += alphabet[randomInt(alphabet.length)];
  return value;
}

/* El nombre de usuario sale de la parte anterior a la arroba, normalizada.
   `taken` responde si un candidato ya existe; se prueban sufijos hasta que
   uno queda libre. Devuelve null si ninguno lo esta: el caso de uso lo
   traduce a USERNAME_TAKEN en vez de dejar que reviente el UNIQUE. */
export async function deriveUsername(email: string, taken: (candidate: string) => Promise<boolean>, attempts = 20): Promise<string | null> {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const base = local.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 24) || "usuario";
  for (let suffix = 0; suffix < attempts; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}${suffix + 1}`;
    if (!(await taken(candidate))) return candidate;
  }
  return null;
}
