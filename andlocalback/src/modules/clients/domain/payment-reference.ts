import { randomBytes } from "node:crypto";

/* La referencia que el cliente escribe en el concepto de sus transferencias.
   Es estable (no cambia por recarga) para que pueda guardarla una vez en su
   banco, y solo usa 0-9 y A-F: son los caracteres que el OCR no confunde entre
   si (el OCR confunde O con 0 e I o L con 1, y ninguno de los tres aparece). */
export function generatePaymentReference(): string {
  return `AND-${randomBytes(4).toString("hex").toUpperCase()}`;
}
