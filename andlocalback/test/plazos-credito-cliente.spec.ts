import { describe, expect, it, vi } from "vitest";
import { recordingAudit } from "./support/security-audit";
import { ManageClients } from "../src/modules/clients/application/use-cases/manage-clients";
import { AdminClientView, ClientAdminRepository } from "../src/modules/clients/application/ports/client-admin.repository";
import { CreditTermsCatalog } from "../src/modules/clients/application/ports/credit-terms.port";
import { InvoiceIssuerCreditTerms } from "../src/modules/clients/infrastructure/invoice-issuer-credit-terms";
import { InvoiceIssuer } from "../src/modules/recharges/application/ports/invoice-issuer.ports";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";

/*
 * Con Migo, una factura pospago necesita un plazo de pago con los días de
 * crédito del cliente. La ficha solo deja guardar días que tienen plazo, para
 * que ninguna factura se quede pendiente por eso.
 */
const postpaid: AdminClientView = {
  id: "c1", name: "Cliente", email: "cliente@example.test", ruc: "1712345675001", address: null, phone: null, manager: null, status: "ACTIVE", createdAt: "2026-09-20T00:00:00.000Z",
  account: { id: "a1", type: AccountType.POSTPAID, status: "ACTIVE", creditDays: 45, creditLimit: 1000, platforms: [AdvertisingPlatform.META] },
  nextDueDate: null, totalRecharged: 0,
};
const prepaid: AdminClientView = { ...postpaid, account: { ...postpaid.account, type: AccountType.PREPAID, creditDays: 0, creditLimit: 0 } };

function repository(current: AdminClientView): ClientAdminRepository {
  return {
    create: vi.fn().mockResolvedValue(current), list: vi.fn(), findById: vi.fn().mockResolvedValue(current), findDetail: vi.fn(),
    update: vi.fn().mockResolvedValue(current), deactivate: vi.fn(), assignManager: vi.fn(), findLoginUsername: vi.fn(), resetPassword: vi.fn(),
  };
}
const credentials = { prepare: vi.fn().mockResolvedValue({ username: "cliente", temporaryPassword: "Abcd2345Wxyz", passwordHash: "h" }), issue: vi.fn() };
const terms = (days: readonly number[] | null): CreditTermsCatalog => ({ allowedDays: vi.fn(async () => days) });
const newClient = (creditDays: number) => ({
  name: "Cliente", email: "cliente@example.test", ruc: "1712345675001", accountType: AccountType.POSTPAID, platforms: [AdvertisingPlatform.META], creditDays, creditLimit: 1000,
});

describe("días de crédito con plazo de pago en Migo", () => {
  it("ofrece los días que tienen plazo, o null si no hay restricción", async () => {
    expect(await new ManageClients(repository(postpaid), credentials, recordingAudit(), terms([7, 30, 45])).creditTermOptions()).toEqual({ days: [7, 30, 45] });
    expect(await new ManageClients(repository(postpaid), credentials, recordingAudit()).creditTermOptions()).toEqual({ days: null });
  });

  it("da de alta un pospago solo con días que tienen plazo y dice cuáles hay", async () => {
    const clients = repository(postpaid);
    const manage = new ManageClients(clients, credentials, recordingAudit(), terms([2, 30]));
    await expect(manage.create(newClient(30), {})).resolves.toMatchObject({ id: "c1" });
    await expect(manage.create(newClient(45), {})).rejects.toMatchObject({
      code: "CREDIT_DAYS_WITHOUT_TERM", status: 409,
      message: "En Migo no hay un plazo de pago de 45 días. Elige uno de estos: 2, 30 días, o crea «Crédito 45 días» en Migo.",
    });
    expect(clients.create).toHaveBeenCalledTimes(1);
  });

  it("el prepago no necesita plazo", async () => {
    const manage = new ManageClients(repository(prepaid), credentials, recordingAudit(), terms([]));
    await expect(manage.create({ ...newClient(0), accountType: AccountType.PREPAID, creditLimit: 0 }, {})).resolves.toMatchObject({ id: "c1" });
  });

  it("al editar, valida si cambian los días o pasa a pospago; si no, deja editar aunque falte el plazo", async () => {
    const clients = repository(postpaid);
    const manage = new ManageClients(clients, credentials, recordingAudit(), terms([30]));
    await expect(manage.update("c1", { name: "Otro nombre" }, {})).resolves.toBeDefined();
    await expect(manage.update("c1", { creditDays: 45 }, {})).resolves.toBeDefined();
    await expect(manage.update("c1", { creditDays: 60 }, {})).rejects.toMatchObject({ code: "CREDIT_DAYS_WITHOUT_TERM" });
    await expect(manage.update("c1", { creditDays: 30 }, {})).resolves.toBeDefined();

    const fromPrepaid = new ManageClients(repository(prepaid), credentials, recordingAudit(), terms([30]));
    await expect(fromPrepaid.update("c1", { accountType: AccountType.POSTPAID, creditDays: 45, creditLimit: 500 }, {})).rejects.toMatchObject({ code: "CREDIT_DAYS_WITHOUT_TERM" });
    await expect(fromPrepaid.update("c1", { accountType: AccountType.PREPAID }, {})).resolves.toBeDefined();
  });

  it("el adaptador pregunta al emisor; sin método o si Migo falla, no restringe", async () => {
    const base = { name: "x", enabled: true, authorize: vi.fn(), document: vi.fn() } satisfies InvoiceIssuer;
    expect(await new InvoiceIssuerCreditTerms({ ...base, creditTermDays: async () => [2, 30] }).allowedDays()).toEqual([2, 30]);
    expect(await new InvoiceIssuerCreditTerms(base).allowedDays()).toBeNull();
    expect(await new InvoiceIssuerCreditTerms({ ...base, creditTermDays: async () => { throw new Error("Migo caído"); } }).allowedDays()).toBeNull();
  });
});
