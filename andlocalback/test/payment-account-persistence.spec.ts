import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaClientAdminRepository } from "../src/modules/clients/infrastructure/prisma-client-admin.repository";
import { PrismaPaymentAccountRepository } from "../src/modules/payment-account/infrastructure/prisma-payment-account.repository";
import { normalizePaymentAccount } from "../src/modules/payment-account/domain/payment-account";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { validRuc } from "./ruc-fixture";
import { createTestDatabase } from "./support/postgres-test-database";

const account = normalizePaymentAccount({
  bankName: "Produbanco", accountType: "Cuenta Pro Pyme", accountNumber: "27059085407",
  holderName: "ANDMD SOCIEDAD POR ACCIONES SIMPLIFICADA", holderTaxId: "1793224091001", email: "cobros@example.test", phone: "0983917295",
});

describe("cuenta de cobro contra la base", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;
  let accounts: PrismaPaymentAccountRepository;

  beforeAll(async () => {
    testDatabase = await createTestDatabase("payment_account");
    prisma = new PrismaClient({ datasourceUrl: testDatabase.url });
    accounts = new PrismaPaymentAccountRepository(prisma as PrismaService);
    await prisma.authUser.createMany({ data: [
      { id: "admin-1", username: "cobros-admin", passwordHash: "x", role: "ADMIN" },
      { id: "admin-2", username: "cobros-otro", passwordHash: "x", role: "ADMIN" },
    ] });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await testDatabase.drop();
  });

  it("sin configurar no hay cuenta activa", async () => {
    expect(await accounts.findActive()).toBeNull();
    expect(await accounts.history(10)).toEqual([]);
  });

  it("guardar crea la cuenta y la primera entrada del historial", async () => {
    const saved = await accounts.saveActive(account, "admin-1");
    expect(saved).toMatchObject({ bankName: "Produbanco", accountNumber: "27059085407", holderTaxId: "1793224091001", updatedById: "admin-1" });
    expect(await accounts.findActive()).toMatchObject({ id: saved.id });
    const [change] = await accounts.history(10);
    expect(change).toMatchObject({ action: "CREATE", changedById: "admin-1", changedByName: "cobros-admin", before: null });
    expect(change.after.accountNumber).toBe("27059085407");
  });

  it("volver a guardar actualiza la misma cuenta y deja el antes y el después", async () => {
    const first = (await accounts.findActive())!;
    const changed = await accounts.saveActive({ ...account, accountNumber: "11112222333", bankName: "Banco Pichincha" }, "admin-2");
    expect(changed.id).toBe(first.id);
    expect(await prisma.paymentAccount.count()).toBe(1);

    const [latest, original] = await accounts.history(10);
    expect(latest).toMatchObject({ action: "UPDATE", changedByName: "cobros-otro" });
    expect(latest.before).toMatchObject({ accountNumber: "27059085407", bankName: "Produbanco" });
    expect(latest.after).toMatchObject({ accountNumber: "11112222333", bankName: "Banco Pichincha" });
    expect(original.action).toBe("CREATE");
    expect(await accounts.history(1)).toHaveLength(1);
  });

  it("guardar exactamente lo mismo no cambia la cuenta ni añade al historial", async () => {
    const current = (await accounts.findActive())!;
    const before = (await accounts.history(50)).length;
    const again = await accounts.saveActive({ ...account, accountNumber: "11112222333", bankName: "Banco Pichincha" }, "admin-1");
    expect(again.updatedAt).toBe(current.updatedAt);
    expect((await accounts.history(50)).length).toBe(before);
  });

  it("con varias cuentas ve la activa de menor posición", async () => {
    await prisma.paymentAccount.create({ data: { ...account, position: 5 } });
    await prisma.paymentAccount.create({ data: { ...account, bankName: "Inactiva", active: false, position: -1 } });
    expect((await accounts.findActive())?.bankName).toBe("Banco Pichincha");
  });

  it("un cliente nuevo nace con su referencia de pago, y solo él la lee", async () => {
    const clients = new PrismaClientAdminRepository(prisma as PrismaService);
    const profile = { name: "Cliente", email: `${randomUUID()}@example.test`, ruc: validRuc(), accountType: AccountType.PREPAID, platforms: [AdvertisingPlatform.META], creditDays: 0 };
    const created = await clients.create(profile, { username: profile.email, passwordHash: "scrypt$s$h" }, null);
    expect(await accounts.findClientReference(created.id)).toMatch(/^AND-[0-9A-F]{8}$/);
    expect(await accounts.findClientReference("no-existe")).toBeNull();
  });
});
