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

export function validateClientProfile(input: { name: string; email: string; accountType: "PREPAGO" | "POSTPAGO"; creditDays: number }): string {
  if (input.name.trim().length < 2) return "El nombre necesita al menos 2 caracteres.";
  /* Comprobación mínima a propósito: la única validación que manda es la del
     backend, y una expresión estricta rechaza correos que sí existen. */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return "Escribe un correo válido.";
  if (input.accountType === "POSTPAGO" && (!Number.isInteger(input.creditDays) || input.creditDays < 1)) return "Una cuenta postpago necesita al menos un día de crédito.";
  return "";
}
