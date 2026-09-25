/* Mensajes de formulario en la voz del producto. El navegador mostraba su
   propio globo negro —«Completa este campo»— con su idioma, su tono y sin
   forma de darle estilo; los formularios llevan `noValidate` y validan aquí.
   Devuelven el mensaje del primer problema, o cadena vacía si todo está bien. */

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export function validateTeamUsername(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Escribe un nombre de usuario.";
  if (normalized.length < 3) return "El usuario necesita al menos 3 caracteres.";
  if (!usernamePattern.test(normalized)) return "El usuario admite letras, números, punto, guion y guion bajo, y empieza por letra o número.";
  return "";
}

/* Espejo de la regla del backend (domain/ruc.ts), para avisar antes de
   enviar; la que manda es la del servidor. El dígito verificador solo se
   exige a personas naturales: el SRI emite RUC de sociedades que no cumplen
   el módulo 11. */
const rucProvinces = new Set([...Array.from({ length: 24 }, (_, index) => index + 1), 30]);

export const normalizeRuc = (value: string) => value.replace(/[\s-]/g, "");

function isValidCedula(cedula: string) {
  const digits = [...cedula].map(Number);
  const sum = digits.slice(0, 9).reduce((total, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === digits[9];
}

export function validateRuc(value: string): string {
  const ruc = normalizeRuc(value);
  if (!ruc) return "Escribe el RUC del cliente.";
  if (!/^\d+$/.test(ruc)) return "El RUC solo admite números.";
  if (ruc.length !== 13) return `El RUC debe tener 13 dígitos; tiene ${ruc.length}.`;
  if (!rucProvinces.has(Number(ruc.slice(0, 2)))) return "Los dos primeros dígitos del RUC no corresponden a una provincia válida.";
  const type = Number(ruc[2]);
  if (type <= 5) {
    if (!isValidCedula(ruc.slice(0, 10))) return "El RUC no corresponde a una cédula válida: revisa los 10 primeros dígitos.";
    return ruc.endsWith("000") ? "Los 3 últimos dígitos del RUC no pueden ser 000." : "";
  }
  if (type === 6) return ruc.endsWith("0000") ? "Los 4 últimos dígitos del RUC no pueden ser 0000." : "";
  if (type === 9) return ruc.endsWith("000") ? "Los 3 últimos dígitos del RUC no pueden ser 000." : "";
  return "El tercer dígito del RUC debe ser 0 a 5 (persona natural), 6 (entidad pública) o 9 (sociedad).";
}

/* Tipo de contribuyente de un RUC ya válido, para confirmarlo en pantalla
   mientras se escribe. null si todavía no es válido. */
export function rucKind(value: string): "persona natural" | "entidad pública" | "sociedad" | null {
  if (validateRuc(value)) return null;
  const type = Number(normalizeRuc(value)[2]);
  return type <= 5 ? "persona natural" : type === 6 ? "entidad pública" : "sociedad";
}

export type ClientProfileField = "name" | "email" | "ruc" | "creditDays";

/* Un mensaje por campo, para pintarlo junto a su campo y no en un único
   aviso al pie que obliga a buscar cuál falló. Solo trae los que fallan. */
export function validateClientFields(input: { name: string; email: string; ruc: string; accountType: "PREPAGO" | "POSTPAGO"; creditDays: number }): Partial<Record<ClientProfileField, string>> {
  const errors: Partial<Record<ClientProfileField, string>> = {};
  if (input.name.trim().length < 2) errors.name = "El nombre necesita al menos 2 caracteres.";
  /* Comprobación mínima a propósito: la única validación que manda es la del
     backend, y una expresión estricta rechaza correos que sí existen. */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) errors.email = "Escribe un correo válido.";
  const ruc = validateRuc(input.ruc);
  if (ruc) errors.ruc = ruc;
  if (input.accountType === "POSTPAGO" && (!Number.isInteger(input.creditDays) || input.creditDays < 1 || input.creditDays > 365)) errors.creditDays = "Entre 1 y 365 días de crédito.";
  return errors;
}
