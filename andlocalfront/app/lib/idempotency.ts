/** Clave nueva para una operación que no debe repetirse. */
export function newIdempotencyKey() {
  return `web-${Date.now()}-${crypto.randomUUID()}`;
}

/**
 * Una clave de idempotencia por intento, no por envío.
 *
 * El servidor guarda la clave con la recarga que creó y, si la recibe otra vez,
 * devuelve esa recarga en lugar de crear otra. Pero solo protege si el
 * reintento llega con la misma clave: antes se generaba una en cada envío, y
 * si la respuesta se perdía (red caída, pestaña lenta) y el cliente volvía a
 * confirmar, salían dos recargas.
 *
 * `keyFor(firma)` devuelve la misma clave mientras la firma (lo que se envía:
 * cuenta, importes, comprobante) no cambie, y una nueva si cambia: con otros
 * importes es otra recarga, y el servidor no compara el contenido, devolvería
 * la anterior. `settle()` se llama al terminar bien, para que la siguiente
 * recarga, aunque sea idéntica, sea otra.
 */
export function createAttemptKeys() {
  let current: { signature: string; key: string } | null = null;
  return {
    keyFor(signature: string) {
      if (current?.signature !== signature) current = { signature, key: newIdempotencyKey() };
      return current.key;
    },
    settle() { current = null; },
  };
}
