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
