import { MigoClientConfig } from "./migo-api.client";
import { MigoIssuerSettings } from "./migo-invoice-issuer";

export const MIGO_DEFAULT_BASE_URL = "https://api.migo.com.ec";
const PLATFORMS = ["META", "GOOGLE", "TIKTOK"] as const;

export type MigoConfiguration = Readonly<{ client: MigoClientConfig; settings: MigoIssuerSettings }>;

/**
 * Lee la configuración de Migo (INVOICE_ISSUER=migo) y la valida entera: si
 * falta algo, el backend no arranca y el mensaje dice todo lo que falta, en
 * vez de descubrirlo al emitir la primera factura.
 *
 * Los ids salen del catálogo de la empresa en Migo (/emission-points/options,
 * /products?establishmentId=, /taxes/options, /identification-types/options,
 * /customer-groups/options, /payment-methods/options, /payment-terms/options).
 */
export function migoConfigurationFromEnv(env: NodeJS.ProcessEnv = process.env): MigoConfiguration {
  const problems: string[] = [];
  const text = (name: string) => env[name]?.trim() || null;
  const required = (name: string) => {
    const value = text(name);
    if (!value) problems.push(`${name} es obligatorio`);
    return value ?? "";
  };
  const id = (name: string, mandatory: boolean): number | null => {
    const value = text(name);
    if (!value) {
      if (mandatory) problems.push(`${name} es obligatorio`);
      return null;
    }
    if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
      problems.push(`${name} debe ser un id entero positivo de Migo`);
      return null;
    }
    return Number(value);
  };

  const baseUrl = text("MIGO_BASE_URL") ?? MIGO_DEFAULT_BASE_URL;
  if (!isAllowedBaseUrl(baseUrl)) problems.push("MIGO_BASE_URL debe ser https (o http://localhost para el emulador de desarrollo)");
  const clientId = required("MIGO_CLIENT_ID");
  const clientSecret = required("MIGO_CLIENT_SECRET");
  const timeout = text("MIGO_TIMEOUT_MS");
  if (timeout && (!/^\d+$/.test(timeout) || Number(timeout) < 1000)) problems.push("MIGO_TIMEOUT_MS debe ser un entero de al menos 1000");

  const emissionPointId = id("MIGO_EMISSION_POINT_ID", true);
  /* Un producto por plataforma: AND factura «Servicio de Intermediación por
     Pauta Meta / Google / Tik Tok», cada uno con su código. */
  const products = Object.fromEntries(
    PLATFORMS.map((platform) => [platform, { id: id(`MIGO_PRODUCT_ID_${platform}`, true), code: text(`MIGO_PRODUCT_CODE_${platform}`) }]),
  );
  const vatTaxId = id("MIGO_VAT_TAX_ID", true);
  const rucIdentificationTypeId = id("MIGO_RUC_IDENTIFICATION_TYPE_ID", true);
  const customerGroupId = id("MIGO_CUSTOMER_GROUP_ID", true);
  const vendorId = id("MIGO_VENDOR_ID", false);
  const activityId = id("MIGO_ACTIVITY_ID", false);
  const prepaidMethodId = id("MIGO_PREPAID_PAYMENT_METHOD_ID", false);
  const creditMethodId = id("MIGO_CREDIT_PAYMENT_METHOD_ID", false);
  const creditTermId = id("MIGO_CREDIT_PAYMENT_TERM_ID", false);
  if ((prepaidMethodId === null) !== (creditMethodId === null)) {
    problems.push("MIGO_PREPAID_PAYMENT_METHOD_ID y MIGO_CREDIT_PAYMENT_METHOD_ID van juntos: los dos o ninguno");
  }
  if (creditTermId !== null && creditMethodId === null) problems.push("MIGO_CREDIT_PAYMENT_TERM_ID necesita MIGO_CREDIT_PAYMENT_METHOD_ID");

  if (problems.length) throw new Error(`Configuración de Migo incompleta (INVOICE_ISSUER=migo):\n- ${problems.join("\n- ")}`);

  return {
    client: { baseUrl, clientId, clientSecret, ...(timeout ? { timeoutMs: Number(timeout) } : {}) },
    settings: {
      emissionPointId: emissionPointId!,
      products: Object.fromEntries(Object.entries(products).map(([platform, product]) => [platform, { id: product.id!, code: product.code }])),
      vatTaxId: vatTaxId!,
      vendorId,
      activityId,
      rucIdentificationTypeId: rucIdentificationTypeId!,
      customerGroupId: customerGroupId!,
      payments: prepaidMethodId !== null && creditMethodId !== null ? { prepaidMethodId, creditMethodId, creditTermId } : null,
    },
  };
}

function isAllowedBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
