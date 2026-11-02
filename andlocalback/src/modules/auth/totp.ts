import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from "node:crypto";

/* TOTP de RFC 6238 (SHA-1, 6 digitos, pasos de 30 s), el que entienden Google
   Authenticator, Microsoft Authenticator, 1Password y el resto. Escrito aqui y
   no con una libreria: son treinta lineas y la cadena de dependencias es la
   superficie que este mismo hardening intenta reducir. */
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const stepSeconds = 30;
export const totpIssuer = "AND Local Ads";

export function base32Encode(bytes: Buffer): string {
  let bits = 0; let value = 0; let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += base32Alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  let bits = 0; let value = 0; const output: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

/* 160 bits, el tamano que recomienda la RFC 4226 para HMAC-SHA1. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / stepSeconds);

/* Acepta el paso actual y uno a cada lado (relojes de movil desfasados hasta
   30 s). Devuelve el paso que coincidio para guardarlo: un paso igual o
   anterior al ultimo aceptado se rechaza, asi un codigo no sirve dos veces. */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const key = base32Decode(secret); const current = totpStep(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(normalized))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string): string {
  const label = `${encodeURIComponent(totpIssuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(totpIssuer)}&algorithm=SHA1&digits=6&period=${stepSeconds}`;
}

/* Codigos de recuperacion: diez, de un solo uso, para quien pierde el movil.
   Mismo alfabeto sin ambiguedades que las claves temporales. Tienen 50 bits de
   azar, asi que basta un SHA-256 para guardarlos (no hay diccionario que probar). */
const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz2346789";
export function generateRecoveryCodes(count = 10): string[] {
  const part = () => Array.from({ length: 5 }, () => recoveryAlphabet[randomInt(recoveryAlphabet.length)]).join("");
  return Array.from({ length: count }, () => `${part()}-${part()}`);
}
export const normalizeRecoveryCode = (code: string) => code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecoveryCode = (code: string) => createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
