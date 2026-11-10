import { MigoApiClient } from "./migo-api.client";
import { MigoLookup } from "./migo-api.types";
import { MigoMappingError } from "./migo-invoice.mapper";

const CACHE_MS = 10 * 60_000;

/** Días de un plazo de Migo a partir de su nombre: «Crédito 30 días» → 30, «2 DIAS» → 2. */
export function paymentTermDays(name: string): number | null {
  const match = /(\d+)\s*d[ií]as?(?![\p{L}])/iu.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Elige el plazo de pago de Migo que corresponde a los días de crédito del
 * cliente, para que la factura del SRI diga el plazo real. Los plazos se
 * crean en Migo y se reconocen por el nombre, así que un cliente con días
 * nuevos solo pide crear el plazo allí, sin tocar la configuración.
 *
 * El catálogo se guarda 10 minutos; si no aparece el plazo se vuelve a
 * consultar enseguida, por si se acaba de crear.
 */
export class MigoPaymentTermCatalog {
  private cache: Readonly<{ terms: readonly MigoLookup[]; loadedAt: number }> | null = null;

  constructor(
    private readonly migo: Pick<MigoApiClient, "listPaymentTerms">,
    private readonly now: () => number = Date.now,
  ) {}

  async termIdFor(days: number): Promise<number> {
    const fresh = this.cache !== null && this.now() - this.cache.loadedAt < CACHE_MS;
    let matches = withDays(fresh ? this.cache!.terms : await this.load(), days);
    if (matches.length === 0 && fresh) matches = withDays(await this.load(), days);
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0) {
      throw new MigoMappingError(`En Migo no hay un plazo de pago de ${days} días. Créalo en Migo con un nombre como «Crédito ${days} días» y la factura saldrá sola en el siguiente intento.`);
    }
    throw new MigoMappingError(`En Migo hay varios plazos de pago de ${days} días (${matches.map((term) => term.name).join(", ")}): deja solo uno.`);
  }

  /** Los días de todos los plazos, leídos de nuevo: un plazo recién creado en
      Migo aparece al momento en la ficha del cliente. */
  async availableDays(): Promise<number[]> {
    const days = (await this.load()).map((term) => paymentTermDays(term.name)).filter((value): value is number => value !== null);
    return [...new Set(days)].sort((a, b) => a - b);
  }

  private async load(): Promise<readonly MigoLookup[]> {
    const terms = await this.migo.listPaymentTerms();
    this.cache = { terms, loadedAt: this.now() };
    return terms;
  }
}

const withDays = (terms: readonly MigoLookup[], days: number) => terms.filter((term) => paymentTermDays(term.name) === days);
