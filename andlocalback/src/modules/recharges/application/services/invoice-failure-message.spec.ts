import { describe, expect, it } from "vitest";
import { describeInvoiceFailure } from "./invoice-failure-message";

const migo = (status: string, rest: string) => `Migo ${status} en POST /api/v1/invoices: ${rest}`;

describe("motivo de una factura sin emitir, dicho claro", () => {
  it("de un rechazo de Migo deja solo su frase de negocio", () => {
    expect(describeInvoiceFailure(migo("422 UNPROCESSABLE_ENTITY", 'Se encontraron errores de validación de negocio · ["La fecha de emisión 09/11/2026 no es válida. Debe ser igual o posterior al 10/11/2026."]')))
      .toBe("Migo rechazó la factura: La fecha de emisión 09/11/2026 no es válida. Debe ser igual o posterior al 10/11/2026.");
    expect(describeInvoiceFailure(migo("422 UNPROCESSABLE_ENTITY", 'Se encontraron errores de validación de negocio · ["Debe seleccionar el término de pago para la forma de pago Cliente Crédito","El cliente no existe"]')))
      .toBe("Migo rechazó la factura: Debe seleccionar el término de pago para la forma de pago Cliente Crédito. El cliente no existe.");
  });

  it("de un rechazo por campos dice cuáles", () => {
    expect(describeInvoiceFailure("Migo 400 BAD_REQUEST en POST /api/v1/customers: Validación fallida en 2 campo(s) · address: No puede estar en blanco; phone: No puede estar en blanco"))
      .toBe("Migo rechazó la factura: datos incompletos o inválidos (address: No puede estar en blanco; phone: No puede estar en blanco).");
  });

  it("no enseña códigos, rutas ni detalles que no son frases", () => {
    const totals = describeInvoiceFailure(migo("422 TOTALS_MISMATCH", 'Los totales calculados no coinciden con los enviados · [{"field":"taxAmount","expected":4.31,"actual":4.3}]'));
    expect(totals).toBe("Migo rechazó la factura por un dato que no acepta. Avisa a soporte para revisarlo.");
    const cut = describeInvoiceFailure(migo("422 UNPROCESSABLE_ENTITY", 'Se encontraron errores · ["Una frase muy larga que se cortó a los trescientos'));
    expect(cut).toBe("Migo rechazó la factura por un dato que no acepta. Avisa a soporte para revisarlo.");
    for (const message of [totals, cut]) expect(message).not.toMatch(/422|POST|\/api\/|TOTALS_MISMATCH|\{/);
  });

  it("caídas, límites y credenciales: qué pasa y si hay que hacer algo", () => {
    expect(describeInvoiceFailure("Migo 503 SERVICE_UNAVAILABLE en POST /api/v1/invoices: Migo en mantenimiento")).toBe("Migo no está disponible en este momento. El sistema lo reintenta solo.");
    expect(describeInvoiceFailure("No se pudo conectar con Migo: ECONNREFUSED")).toBe("No se pudo conectar con Migo. El sistema lo reintenta solo.");
    expect(describeInvoiceFailure("No se pudo conectar con Migo: no respondió a tiempo")).toBe("No se pudo conectar con Migo. El sistema lo reintenta solo.");
    expect(describeInvoiceFailure("Migo: se superó el límite de 10 tokens por hora de la credencial")).toBe("Migo limitó las peticiones por un momento. El sistema lo reintenta solo.");
    expect(describeInvoiceFailure("Migo 429 TOO_MANY_REQUESTS en GET /api/v1/customers?search=1: demasiadas")).toBe("Migo limitó las peticiones por un momento. El sistema lo reintenta solo.");
    expect(describeInvoiceFailure("Migo 401 en POST /oauth2/token: Credenciales inválidas")).toBe("Migo rechazó el acceso de AND. Hay que revisar la credencial de la API en Migo.");
    expect(describeInvoiceFailure("Migo 403 FORBIDDEN en POST /api/v1/customers: sin permiso CUSTOMER:CREATE")).toMatch(/revisar la credencial/);
  });

  it("deja tal cual lo que el sistema ya escribe para una persona", () => {
    for (const readable of [
      "En Migo no hay un plazo de pago de 45 días. Créalo en Migo con un nombre como «Crédito 45 días» y la factura saldrá sola en el siguiente intento.",
      "En Migo hay varios plazos de pago de 30 días (Crédito 30 días, 30 dias): deja solo uno.",
      "La factura FAC-TX-1 no tiene RUC del cliente",
      "La factura FAC-TX-1 es pospago y no tiene días de crédito",
      "El SRI no autorizó la factura: IDENTIFICACION DEL COMPRADOR INVALIDA",
      "La factura fue anulada en Migo",
    ]) expect(describeInvoiceFailure(readable)).toBe(readable);
  });

  it("un error interno no se enseña: puede traer detalles técnicos", () => {
    const generic = "No se pudo emitir la factura por un error interno. El sistema lo reintenta solo. Si sigue así, avisa a soporte.";
    expect(describeInvoiceFailure("Cannot read properties of undefined (reading 'id')")).toBe(generic);
    expect(describeInvoiceFailure("Descuadre en total: las líneas suman 33.06 y la factura dice 40.00")).toBe(generic);
    expect(describeInvoiceFailure("Invalid `prisma.invoice.update()` invocation")).toBe(generic);
  });

  it("sin motivo no inventa uno", () => {
    expect(describeInvoiceFailure(null)).toBeNull();
    expect(describeInvoiceFailure("  ")).toBeNull();
  });
});
