import { describe, expect, it, vi } from "vitest";
import { MigoLookup } from "./migo-api.types";
import { MigoMappingError } from "./migo-invoice.mapper";
import { MigoPaymentTermCatalog, paymentTermDays } from "./migo-payment-terms";

const term = (id: number, name: string): MigoLookup => ({ id, code: null, name });
const AND_TERMS = [term(21299, "2 DIAS"), term(21297, "Crédito 30 días")];

describe("plazos de pago de Migo", () => {
  it("lee los días del nombre del plazo, con o sin tilde y en mayúsculas", () => {
    expect(paymentTermDays("Crédito 30 días")).toBe(30);
    expect(paymentTermDays("2 DIAS")).toBe(2);
    expect(paymentTermDays("CRÉDITO 15 DÍAS")).toBe(15);
    expect(paymentTermDays("1 día")).toBe(1);
    expect(paymentTermDays("45dias")).toBe(45);
    expect(paymentTermDays("Contado")).toBeNull();
    expect(paymentTermDays("30 diarios")).toBeNull();
  });

  it("elige el plazo con los días del cliente y guarda el catálogo unos minutos", async () => {
    const migo = { listPaymentTerms: vi.fn(async () => AND_TERMS) };
    const catalog = new MigoPaymentTermCatalog(migo, () => 0);
    expect(await catalog.termIdFor(30)).toBe(21297);
    expect(await catalog.termIdFor(2)).toBe(21299);
    expect(migo.listPaymentTerms).toHaveBeenCalledTimes(1);
  });

  it("si no está, vuelve a consultar por si se acaba de crear; si sigue sin estar, dice cuál crear", async () => {
    const terms = [...AND_TERMS];
    const migo = { listPaymentTerms: vi.fn(async () => [...terms]) };
    const catalog = new MigoPaymentTermCatalog(migo, () => 0);
    await catalog.termIdFor(30);
    await expect(catalog.termIdFor(5)).rejects.toThrow(new MigoMappingError("En Migo no hay un plazo de pago de 5 días. Créalo en Migo con un nombre como «Crédito 5 días» y la factura saldrá sola en el siguiente intento."));
    terms.push(term(30005, "Crédito 5 días"));
    expect(await catalog.termIdFor(5)).toBe(30005);
  });

  it("con dos plazos de los mismos días no adivina", async () => {
    const catalog = new MigoPaymentTermCatalog({ listPaymentTerms: async () => [...AND_TERMS, term(1, "30 dias")] });
    await expect(catalog.termIdFor(30)).rejects.toThrow(/varios plazos de pago de 30 días \(Crédito 30 días, 30 dias\): deja solo uno/);
  });

  it("lista los días disponibles, sin repetir, ordenados y leídos de nuevo cada vez", async () => {
    const migo = { listPaymentTerms: vi.fn(async () => [term(1, "Crédito 45 días"), ...AND_TERMS, term(2, "Contado"), term(3, "45 DIAS")]) };
    const catalog = new MigoPaymentTermCatalog(migo, () => 0);
    expect(await catalog.availableDays()).toEqual([2, 30, 45]);
    await catalog.availableDays();
    expect(migo.listPaymentTerms).toHaveBeenCalledTimes(2);
  });

  it("pasados 10 minutos vuelve a leer el catálogo", async () => {
    let now = 0;
    const migo = { listPaymentTerms: vi.fn(async () => AND_TERMS) };
    const catalog = new MigoPaymentTermCatalog(migo, () => now);
    await catalog.termIdFor(30);
    now = 10 * 60_000;
    await catalog.termIdFor(30);
    expect(migo.listPaymentTerms).toHaveBeenCalledTimes(2);
  });
});
