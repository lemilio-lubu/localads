/**
 * Cuánto esperar antes de volver a pedir la autorización de una factura que
 * falló. Los primeros reintentos son rápidos (un corte de red se arregla
 * solo); después se espacian, porque un rechazo del proveedor por datos no
 * cambia hasta que alguien lo corrige, y entonces se reintenta a mano.
 */
const DELAYS_MINUTES = [1, 2, 5, 15, 60] as const;

export class InvoiceRetryPolicy {
  /** `failedAttempts`: fallos seguidos, contando el que acaba de ocurrir. */
  static nextAttemptAt(failedAttempts: number, now: Date): Date {
    const index = Math.min(Math.max(Math.trunc(failedAttempts), 1), DELAYS_MINUTES.length) - 1;
    return new Date(now.getTime() + DELAYS_MINUTES[index] * 60_000);
  }
}
