import { describe, expect, it } from "vitest";
import { optionalContact, validateClientProfile } from "../src/modules/clients/domain/client-profile";
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

  describe("dirección y teléfono (para dar de alta al cliente en Migo)", () => {
    const base = { name: "Cliente", email: "c@example.test", ruc: "1791234561001", accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 };

    it("son opcionales y el texto vacío significa sin dato", () => {
      expect(() => validateClientProfile(base)).not.toThrow();
      expect(optionalContact("  Av. Amazonas  ")).toBe("Av. Amazonas");
      expect(optionalContact("   ")).toBeNull();
      expect(optionalContact(null)).toBeNull();
      expect(optionalContact(undefined)).toBeUndefined();
    });

    it("acepta teléfonos fijos, móviles e internacionales", () => {
      for (const phone of ["0991234567", "02 245 6789", "(02) 245-6789", "+593 99 123 4567"]) {
        expect(() => validateClientProfile({ ...base, phone })).not.toThrow();
      }
    });

    it("rechaza un teléfono con letras, demasiado corto o demasiado largo, y una dirección de más de 200", () => {
      for (const phone of ["abc", "12345", "0".repeat(21), "099-123-456a"]) {
        expect(() => validateClientProfile({ ...base, phone })).toThrowError(expect.objectContaining({ code: "INVALID_PHONE" }));
      }
      expect(() => validateClientProfile({ ...base, address: "x".repeat(201) })).toThrowError(expect.objectContaining({ code: "INVALID_ADDRESS" }));
    });
  });
});
