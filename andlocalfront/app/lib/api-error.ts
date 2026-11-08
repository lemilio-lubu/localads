/* El texto de error que la pantalla muestra para una respuesta fallida.

   Si el backend responde un 500 con su requestId, se añade al final
   «Código de referencia: 4fbfb81d» (los primeros 8 caracteres, que bastan para
   encontrarlo en los logs y en la pantalla de seguridad). Va dentro del texto
   para que llegue a todas las pantallas sin tocarlas: donde el error se pinta
   tal cual se lee como una frase más, y LoadError y FormError lo separan en
   su propia línea con un botón de copiar (splitErrorReference).

   La decisión se toma sobre el estado y el código, nunca sobre el texto. */
const referenceLabel = "Código de referencia:";
const referencePattern = /\s*Código de referencia: ([0-9a-f]{8})$/;

export function apiErrorMessage(response: Pick<Response, "status">, payload: unknown, fallback: string): string {
  const body = payload && typeof payload === "object" ? payload as { message?: unknown; code?: unknown; requestId?: unknown } : null;
  const raw = body?.message;
  const text = Array.isArray(raw) ? raw.filter((part) => typeof part === "string").join(". ") : typeof raw === "string" && raw ? raw : fallback;
  const reference = response.status >= 500 && body?.code === "INTERNAL_ERROR" && typeof body.requestId === "string" && /^[0-9a-f]{8}/i.test(body.requestId)
    ? body.requestId.slice(0, 8).toLowerCase()
    : null;
  return reference ? `${text} ${referenceLabel} ${reference}` : text;
}

export function splitErrorReference(message: string): { text: string; reference: string | null } {
  const match = referencePattern.exec(message);
  return match ? { text: message.slice(0, match.index), reference: match[1] } : { text: message, reference: null };
}
