/**
 * El motivo por el que una factura no salió, dicho para quien administra AND
 * y no para quien lee logs. El motivo original («Migo 422
 * UNPROCESSABLE_ENTITY en POST /api/v1/invoices: …») se sigue guardando y
 * registrando tal cual; esto solo decide qué se enseña en pantalla.
 *
 * Lo que no se reconoce no se muestra: un error interno puede traer detalles
 * técnicos que no le sirven a nadie fuera del equipo.
 */
const RETRIES_ALONE = "El sistema lo reintenta solo.";
const UNKNOWN = `No se pudo emitir la factura por un error interno. ${RETRIES_ALONE} Si sigue así, avisa a soporte.`;

/* «Migo 422 UNPROCESSABLE_ENTITY en POST /api/v1/invoices: mensaje · campos · ["detalles"]» */
const PROVIDER_ERROR = /^Migo (\d{3})(?: [A-Z_]+)? en (?:GET|POST) \S+: ([\s\S]*)$/;

/* Mensajes que ya escribe el sistema para una persona. */
const READABLE = [
  /^En Migo /, /^La factura \S+ (es pospago|no tiene)/, /^La factura fue anulada/, /^El SRI no autorizó/, /^Migo reportó un error/,
];

export function describeInvoiceFailure(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  if (!text) return null;

  if (text.startsWith("No se pudo conectar con Migo")) return `No se pudo conectar con Migo. ${RETRIES_ALONE}`;
  if (text.startsWith("Migo: se superó el límite")) return `Migo limitó las peticiones por un momento. ${RETRIES_ALONE}`;

  const provider = PROVIDER_ERROR.exec(text);
  if (provider) {
    const status = Number(provider[1]);
    if (status === 401 || status === 403) return "Migo rechazó el acceso de AND. Hay que revisar la credencial de la API en Migo.";
    if (status === 429) return `Migo limitó las peticiones por un momento. ${RETRIES_ALONE}`;
    if (status >= 500) return `Migo no está disponible en este momento. ${RETRIES_ALONE}`;
    const [, ...rest] = provider[2].split(" · ");
    const details = businessDetails(rest);
    if (details) return `Migo rechazó la factura: ${details}`;
    return "Migo rechazó la factura por un dato que no acepta. Avisa a soporte para revisarlo.";
  }

  if (READABLE.some((pattern) => pattern.test(text))) return text;
  return UNKNOWN;
}

/* Las frases de negocio de Migo vienen en español, en una lista JSON al
   final («["La fecha de emisión … no es válida."]»); los campos inválidos,
   como «address: No puede estar en blanco». Otra cosa (objetos de un
   descuadre de totales) no se enseña. */
function businessDetails(parts: readonly string[]): string | null {
  const phrases: string[] = [];
  for (const part of parts) {
    if (part.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(part);
        if (Array.isArray(parsed)) phrases.push(...parsed.filter((item): item is string => typeof item === "string"));
      } catch { /* lista cortada a 300 caracteres: no se enseña */ }
    } else if (/^[\w.]+: /.test(part)) {
      phrases.push(`datos incompletos o inválidos (${part})`);
    }
  }
  const clean = phrases.map((phrase) => phrase.trim()).filter(Boolean).map((phrase) => (/[.!?]$/.test(phrase) ? phrase : `${phrase}.`));
  return clean.length ? clean.join(" ") : null;
}
