/* Politica de NIST SP 800-63B: largo minimo y lista de claves conocidas, sin
   reglas de composicion (obligar a mayusculas y simbolos produce «Clave2026!»).
   La lista es corta a proposito: las mas usadas, en ingles y en espanol, y las
   propias del negocio. */
export const passwordMinLength = 12;
export const passwordMaxLength = 200;

const common = new Set([
  "123456789012", "1234567890123", "123456789abc", "qwertyuiop12", "qwertyuiopas", "asdfghjklñ12",
  "password1234", "password12345", "passw0rd1234", "contraseña12", "contraseña123", "contrasena123",
  "iloveyou1234", "teamo1234567", "administrador", "administrator", "admin1234567", "adminadmin12",
  "andlocalads1", "andlocalads12", "andlocal1234", "localads1234", "bienvenido123", "welcome12345",
  "ecuador12345", "guayaquil123", "quito1234567", "111111111111", "000000000000", "abcdefghijkl",
  "abc123456789", "1q2w3e4r5t6y", "zaq12wsxcde3", "letmein12345", "monkey123456", "dragon123456",
]);

/* Devuelve el motivo por el que no vale, o null si vale. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < passwordMinLength) return `La contraseña debe tener al menos ${passwordMinLength} caracteres`;
  if (password.length > passwordMaxLength) return `La contraseña no puede pasar de ${passwordMaxLength} caracteres`;
  const lowered = password.toLowerCase();
  if (common.has(lowered) || /^(.)\1+$/.test(password)) return "Esa contraseña es demasiado común; elige otra";
  const local = username?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lowered.includes(local)) return "La contraseña no puede contener tu usuario";
  return null;
}
