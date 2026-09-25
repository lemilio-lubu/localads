import { describe, expect, it } from "vitest";
import { validateClientProfile } from "../src/modules/clients/domain/client-profile";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";

describe("Administración de clientes", () => {
  it("acepta un cliente POSTPAGO con días de crédito y plataformas únicas", () => {
    expect(() => validateClientProfile({
      name: "Cliente", email: "cliente@andlocal.test", ruc: "1712345675001", accountType: AccountType.POSTPAID,
      platforms: [AdvertisingPlatform.META, AdvertisingPlatform.GOOGLE], creditDays: 15,
    })).not.toThrow();
  });

  it("rechaza días de crédito en una cuenta PREPAGO", () => {
    expect(() => validateClientProfile({
      name: "Cliente", email: "cliente@andlocal.test", ruc: "1712345675001", accountType: AccountType.PREPAID,
      platforms: [AdvertisingPlatform.META], creditDays: 5,
    })).toThrowError(expect.objectContaining({ code: "INVALID_CREDIT_DAYS" }));
  });

  it("rechaza una cuenta POSTPAGO sin plazo de credito", () => {
    expect(() => validateClientProfile({
      name: "Cliente", email: "cliente@andlocal.test", ruc: "1712345675001", accountType: AccountType.POSTPAID,
      platforms: [AdvertisingPlatform.META], creditDays: 0,
    })).toThrowError(expect.objectContaining({ code: "INVALID_CREDIT_DAYS" }));
  });

  it("rechaza plataformas duplicadas", () => {
    expect(() => validateClientProfile({
      name: "Cliente", email: "cliente@andlocal.test", ruc: "1712345675001", accountType: AccountType.POSTPAID,
      platforms: [AdvertisingPlatform.META, AdvertisingPlatform.META], creditDays: 5,
    })).toThrowError(expect.objectContaining({ code: "DUPLICATED_PLATFORM" }));
  });
});
