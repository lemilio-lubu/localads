import { randomInt } from "node:crypto";

/* RUC de persona natural valido y distinto en cada llamada: el RUC es UNIQUE,
   asi que los tests que crean varios clientes contra la base no pueden
   compartir uno fijo. Provincia 17, tercer digito 0-5, cedula con modulo 10. */
export function validRuc(): string {
  const base = `17${randomInt(6)}${String(randomInt(1_000_000)).padStart(6, "0")}`;
  const sum = [...base].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return `${base}${(10 - (sum % 10)) % 10}001`;
}
