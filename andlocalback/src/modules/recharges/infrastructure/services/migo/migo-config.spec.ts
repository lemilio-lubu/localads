import { describe, expect, it } from "vitest";
import { migoConfigurationFromEnv } from "./migo-config";

const minimal = {
  MIGO_CLIENT_ID: "id",
  MIGO_CLIENT_SECRET: "secret",
  MIGO_EMISSION_POINT_ID: "239",
  MIGO_PRODUCT_ID_META: "6644066",
  MIGO_PRODUCT_ID_GOOGLE: "6644062",
  MIGO_PRODUCT_ID_TIKTOK: "6644068",
  MIGO_VAT_TAX_ID: "4",
  MIGO_RUC_IDENTIFICATION_TYPE_ID: "1",
  MIGO_CUSTOMER_GROUP_ID: "2",
};

describe("configuración de Migo", () => {
  it("con lo mínimo usa la API de producción y no envía formas de pago, vendedor ni actividad", () => {
    expect(migoConfigurationFromEnv(minimal)).toEqual({
      client: { baseUrl: "https://api.migo.com.ec", clientId: "id", clientSecret: "secret" },
      settings: {
        emissionPointId: 239, vatTaxId: 4, vendorId: null, activityId: null,
        products: { META: { id: 6644066, code: null }, GOOGLE: { id: 6644062, code: null }, TIKTOK: { id: 6644068, code: null } },
        rucIdentificationTypeId: 1, customerGroupId: 2, payments: null,
      },
    });
  });

  it("lee los opcionales", () => {
    const configuration = migoConfigurationFromEnv({
      ...minimal, MIGO_BASE_URL: "http://localhost:4010", MIGO_TIMEOUT_MS: "5000", MIGO_PRODUCT_CODE_META: " 05 ", MIGO_VENDOR_ID: "12", MIGO_ACTIVITY_ID: "1",
      MIGO_PREPAID_PAYMENT_METHOD_ID: "3", MIGO_CREDIT_PAYMENT_METHOD_ID: "7", MIGO_CREDIT_PAYMENT_TERM_ID: "2",
    });
    expect(configuration.client).toEqual({ baseUrl: "http://localhost:4010", clientId: "id", clientSecret: "secret", timeoutMs: 5000 });
    expect(configuration.settings).toMatchObject({ products: { META: { id: 6644066, code: "05" }, GOOGLE: { code: null } }, vendorId: 12, activityId: 1, payments: { prepaidMethodId: 3, creditMethodId: 7, creditTermId: 2 } });
  });

  it("sin nada, dice todo lo que falta de una vez (el backend no arranca)", () => {
    expect(() => migoConfigurationFromEnv({})).toThrow(/MIGO_CLIENT_ID es obligatorio[\s\S]*MIGO_CLIENT_SECRET[\s\S]*MIGO_EMISSION_POINT_ID[\s\S]*MIGO_PRODUCT_ID_META[\s\S]*MIGO_PRODUCT_ID_GOOGLE[\s\S]*MIGO_PRODUCT_ID_TIKTOK[\s\S]*MIGO_VAT_TAX_ID[\s\S]*MIGO_RUC_IDENTIFICATION_TYPE_ID[\s\S]*MIGO_CUSTOMER_GROUP_ID/);
  });

  it("rechaza ids no numéricos, http fuera de localhost, timeout corto y formas de pago a medias", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ MIGO_PRODUCT_ID_TIKTOK: "abc" }, /MIGO_PRODUCT_ID_TIKTOK debe ser un id entero positivo/],
      [{ MIGO_VAT_TAX_ID: "0" }, /MIGO_VAT_TAX_ID debe ser un id entero positivo/],
      [{ MIGO_BASE_URL: "http://api.migo.com.ec" }, /MIGO_BASE_URL debe ser https/],
      [{ MIGO_BASE_URL: "no es url" }, /MIGO_BASE_URL debe ser https/],
      [{ MIGO_TIMEOUT_MS: "10" }, /MIGO_TIMEOUT_MS/],
      [{ MIGO_PREPAID_PAYMENT_METHOD_ID: "3" }, /los dos o ninguno/],
      [{ MIGO_CREDIT_PAYMENT_TERM_ID: "2" }, /necesita MIGO_CREDIT_PAYMENT_METHOD_ID/],
    ];
    for (const [overrides, message] of cases) expect(() => migoConfigurationFromEnv({ ...minimal, ...overrides })).toThrow(message);
  });

  it("el mensaje de error no incluye el secreto", () => {
    const error = (() => { try { migoConfigurationFromEnv({ ...minimal, MIGO_PRODUCT_ID_META: "x" }); } catch (caught) { return caught as Error; } })();
    expect(error?.message).not.toContain("secret");
  });
});
