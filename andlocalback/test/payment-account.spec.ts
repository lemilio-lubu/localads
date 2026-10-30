import { describe, expect, it, vi } from "vitest";
import { normalizePaymentAccount } from "../src/modules/payment-account/domain/payment-account";
import { PaymentAccountRepository, PaymentAccountView } from "../src/modules/payment-account/application/ports/payment-account.repository";
import { GetPaymentAccount } from "../src/modules/payment-account/application/use-cases/get-payment-account";
import { ListPaymentAccountHistory } from "../src/modules/payment-account/application/use-cases/list-payment-account-history";
import { UpdatePaymentAccount } from "../src/modules/payment-account/application/use-cases/update-payment-account";
import { generatePaymentReference } from "../src/modules/clients/domain/payment-reference";
import { ROLES_KEY } from "../src/modules/auth/auth.decorators";
import { PaymentAccountController } from "../src/modules/payment-account/presentation/payment-account.controller";

const input = {
  bankName: " Produbanco ", accountType: "Cuenta  Pro Pyme", accountNumber: "2705 9085-407",
  holderName: "ANDMD SOCIEDAD POR ACCIONES SIMPLIFICADA", holderTaxId: "1793224091001",
  email: " Cobros@Example.test ", phone: "098 391-7295",
};

const view: PaymentAccountView = {
  id: "pa-1", bankName: "Produbanco", accountType: "Cuenta Pro Pyme", accountNumber: "27059085407",
  holderName: "ANDMD SOCIEDAD POR ACCIONES SIMPLIFICADA", holderTaxId: "1793224091001", email: null, phone: null,
  updatedAt: "2026-10-30T00:00:00.000Z", updatedById: "admin-1",
};

function repository(overrides: Partial<PaymentAccountRepository> = {}): PaymentAccountRepository {
  return {
    findActive: vi.fn().mockResolvedValue(view),
    saveActive: vi.fn().mockResolvedValue(view),
    history: vi.fn().mockResolvedValue([]),
    findClientReference: vi.fn().mockResolvedValue("AND-3F9A1C7B"),
    ...overrides,
  };
}

describe("normalizePaymentAccount", () => {
  it("deja los datos tal como se teclean en el banco", () => {
    expect(normalizePaymentAccount(input)).toEqual({
      bankName: "Produbanco", accountType: "Cuenta Pro Pyme", accountNumber: "27059085407",
      holderName: "ANDMD SOCIEDAD POR ACCIONES SIMPLIFICADA", holderTaxId: "1793224091001",
      email: "cobros@example.test", phone: "0983917295",
    });
  });

  it("correo y celular son opcionales", () => {
    expect(normalizePaymentAccount({ ...input, email: "", phone: undefined })).toMatchObject({ email: null, phone: null });
  });

  it.each([
    ["número con letras", { accountNumber: "27059X85407" }, /número de cuenta/],
    ["número demasiado corto", { accountNumber: "12345" }, /número de cuenta/],
    ["banco vacío", { bankName: "  " }, /banco/],
    ["titular vacío", { holderName: "" }, /titular/],
    ["correo sin arroba", { email: "cobros.example.test" }, /correo/],
    ["celular con letras", { phone: "09839abc" }, /celular/],
  ])("rechaza %s con INVALID_PAYMENT_ACCOUNT", (_name, change, message) => {
    expect(() => normalizePaymentAccount({ ...input, ...change })).toThrowError(expect.objectContaining({ code: "INVALID_PAYMENT_ACCOUNT", message: expect.stringMatching(message) }));
  });

  it("valida el RUC del titular con la regla de clientes", () => {
    expect(() => normalizePaymentAccount({ ...input, holderTaxId: "123" })).toThrowError(expect.objectContaining({ code: "INVALID_RUC" }));
  });
});

describe("GetPaymentAccount", () => {
  it("al cliente le da la cuenta y su referencia, tomada de su propio cliente", async () => {
    const accounts = repository();
    expect(await new GetPaymentAccount(accounts).execute({ clientId: "client-1" })).toEqual({ account: view, reference: "AND-3F9A1C7B" });
    expect(accounts.findClientReference).toHaveBeenCalledWith("client-1");
  });

  it("al equipo le da la cuenta sin consultar ninguna referencia", async () => {
    const accounts = repository();
    expect(await new GetPaymentAccount(accounts).execute({ clientId: null })).toEqual({ account: view, reference: null });
    expect(accounts.findClientReference).not.toHaveBeenCalled();
  });

  it("sin cuenta configurada devuelve null en lugar de fallar", async () => {
    expect(await new GetPaymentAccount(repository({ findActive: vi.fn().mockResolvedValue(null) })).execute({ clientId: "client-1" })).toMatchObject({ account: null });
  });
});

describe("UpdatePaymentAccount", () => {
  it("guarda lo normalizado y firma con el administrador", async () => {
    const accounts = repository();
    await new UpdatePaymentAccount(accounts).execute({ administratorId: " admin-1 ", account: input });
    expect(accounts.saveActive).toHaveBeenCalledWith(expect.objectContaining({ accountNumber: "27059085407", email: "cobros@example.test" }), "admin-1");
  });

  it("sin administrador no guarda nada", async () => {
    const accounts = repository();
    await expect(new UpdatePaymentAccount(accounts).execute({ administratorId: " ", account: input })).rejects.toMatchObject({ code: "ADMINISTRATOR_REQUIRED" });
    expect(accounts.saveActive).not.toHaveBeenCalled();
  });

  it("un dato inválido no llega al repositorio", async () => {
    const accounts = repository();
    await expect(new UpdatePaymentAccount(accounts).execute({ administratorId: "admin-1", account: { ...input, accountNumber: "abc" } })).rejects.toMatchObject({ code: "INVALID_PAYMENT_ACCOUNT" });
    expect(accounts.saveActive).not.toHaveBeenCalled();
  });
});

describe("ListPaymentAccountHistory", () => {
  it("acota el límite pedido", async () => {
    const accounts = repository();
    const list = new ListPaymentAccountHistory(accounts);
    await list.execute(999);
    await list.execute(0);
    await list.execute();
    expect(vi.mocked(accounts.history).mock.calls.map(([limit]) => limit)).toEqual([50, 20, 20]);
  });
});

describe("generatePaymentReference", () => {
  it("tiene la forma AND-XXXXXXXX con solo 0-9 y A-F, que el OCR no confunde", () => {
    const references = Array.from({ length: 200 }, () => generatePaymentReference());
    expect(references.every((reference) => /^AND-[0-9A-F]{8}$/.test(reference))).toBe(true);
    expect(new Set(references).size).toBe(references.length);
  });
});

describe("PaymentAccountController", () => {
  const rolesOf = (handler: unknown) => Reflect.getMetadata(ROLES_KEY, handler as object);

  it("cambiar la cuenta y ver su historial es solo del administrador", () => {
    expect(rolesOf(PaymentAccountController.prototype.update)).toEqual(["ADMIN"]);
    expect(rolesOf(PaymentAccountController.prototype.history)).toEqual(["ADMIN"]);
  });

  it("verla la pueden todos los roles; la referencia solo sale para el cliente del token", async () => {
    expect(rolesOf(PaymentAccountController.prototype.get)).toEqual(["CLIENT", "GESTOR", "ADMIN"]);
    const get = vi.fn().mockResolvedValue({ account: null, reference: null });
    const controller = new PaymentAccountController({ execute: get } as never, {} as never, {} as never);
    const principal = { userId: "u", username: "x", accountId: null, accountType: null };
    await controller.get({ ...principal, role: "CLIENT", clientId: "client-1" });
    await controller.get({ ...principal, role: "GESTOR", clientId: "client-9" });
    expect(get.mock.calls).toEqual([[{ clientId: "client-1" }], [{ clientId: null }]]);
  });
});
