/* Días de crédito que se pueden facturar. Con Migo, cada número necesita un
   plazo de pago creado allí; sin él la factura pospago no sale. null: no hay
   restricción (emisor simulado o desactivado, o Migo no respondió). */
export interface CreditTermsCatalog {
  allowedDays(): Promise<readonly number[] | null>;
}

export const CREDIT_TERMS_CATALOG = Symbol("CREDIT_TERMS_CATALOG");

export const ANY_CREDIT_DAYS: CreditTermsCatalog = { allowedDays: async () => null };
