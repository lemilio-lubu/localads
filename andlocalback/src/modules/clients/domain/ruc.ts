import { ApplicationError } from "../../../common/errors/application.error";

/* RUC ecuatoriano (SRI): 13 digitos. Los dos primeros son la provincia, el
   tercero el tipo de contribuyente y los ultimos el establecimiento.

   - 0 a 5, persona natural: los 10 primeros son su cedula, con verificador
     modulo 10, y el establecimiento son los 3 ultimos.
   - 6, entidad publica: establecimiento en los 4 ultimos.
   - 9, sociedad privada: establecimiento en los 3 ultimos.

   El verificador solo se exige a personas naturales. El SRI emite desde hace
   unos anos RUC de sociedades que no cumplen el modulo 11, y rechazarlos
   dejaria fuera a contribuyentes reales; a ellos se les valida la estructura. */
const PROVINCES = new Set([...Array.from({ length: 24 }, (_, index) => index + 1), 30]);

const invalid = (message: string) => new ApplicationError("INVALID_RUC", message);

export function normalizeRuc(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function isValidCedula(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;
  const digits = [...cedula].map(Number);
  const sum = digits.slice(0, 9).reduce((total, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === digits[9];
}

/* Devuelve el RUC normalizado (sin espacios ni guiones) o lanza INVALID_RUC
   con el motivo concreto: quien lo escribe necesita saber que corregir. */
export function validateRuc(value: string): string {
  const ruc = normalizeRuc(value);
  if (!ruc) throw invalid("El RUC es obligatorio");
  if (!/^\d+$/.test(ruc)) throw invalid("El RUC solo admite números");
  if (ruc.length !== 13) throw invalid("El RUC debe tener 13 dígitos");
  if (!PROVINCES.has(Number(ruc.slice(0, 2)))) throw invalid("Los dos primeros dígitos del RUC no corresponden a una provincia válida");

  const type = Number(ruc[2]);
  if (type <= 5) {
    if (!isValidCedula(ruc.slice(0, 10))) throw invalid("El RUC no corresponde a una cédula válida: revisa los 10 primeros dígitos");
    if (ruc.slice(10) === "000") throw invalid("Los 3 últimos dígitos del RUC (establecimiento) no pueden ser 000");
    return ruc;
  }
  if (type === 6) {
    if (ruc.slice(9) === "0000") throw invalid("Los 4 últimos dígitos del RUC (establecimiento) no pueden ser 0000");
    return ruc;
  }
  if (type === 9) {
    if (ruc.slice(10) === "000") throw invalid("Los 3 últimos dígitos del RUC (establecimiento) no pueden ser 000");
    return ruc;
  }
  throw invalid("El tercer dígito del RUC debe ser 0 a 5 (persona natural), 6 (entidad pública) o 9 (sociedad)");
}
