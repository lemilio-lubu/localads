import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { AuthorizeInvoice } from "../src/modules/recharges/application/use-cases/authorize-invoice";
import { AuthorizePendingInvoices } from "../src/modules/recharges/application/use-cases/authorize-pending-invoices";
import { GetInvoiceDocument } from "../src/modules/recharges/application/use-cases/get-invoice-document";
import { TransactionDetailStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AndPricingPolicy } from "../src/modules/recharges/domain/policies/and-pricing.policy";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";
import { MonetaryAmount } from "../src/modules/recharges/domain/value-objects/monetary-amount";
import { PrismaInvoiceAuthorizationRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-invoice-authorization.repository";
import { MigoApiClient } from "../src/modules/recharges/infrastructure/services/migo/migo-api.client";
import { MigoInvoiceIssuer, MigoIssuerSettings } from "../src/modules/recharges/infrastructure/services/migo/migo-invoice-issuer";
import { FAKE_MIGO_EMISSION_POINT_ID, FAKE_MIGO_PRODUCTS, FAKE_MIGO_VAT_TAX_ID, FakeMigo, startFakeMigo } from "./support/fake-migo-server";
import { createTestDatabase } from "./support/postgres-test-database";

/*
 * Flujo completo de facturación con Migo: base PostgreSQL con las
 * migraciones reales, repositorio Prisma, casos de uso y cliente HTTP reales,
 * contra un emulador de la API de Migo que aplica sus validaciones.
 */
describe("integración: facturación electrónica con Migo", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaClient;
  let migo: FakeMigo;
  let authorize: AuthorizeInvoice;
  let authorizePending: AuthorizePendingInvoices;
  let getDocument: GetInvoiceDocument;
  const now = new Date("2026-11-07T16:00:00.000Z");
  const pricing = new AndPricingPolicy();
  let counter = 0;

  const settings: MigoIssuerSettings = {
    emissionPointId: FAKE_MIGO_EMISSION_POINT_ID, vatTaxId: FAKE_MIGO_VAT_TAX_ID,
    products: { META: { id: FAKE_MIGO_PRODUCTS.META, code: "05" }, GOOGLE: { id: FAKE_MIGO_PRODUCTS.GOOGLE, code: "04" }, TIKTOK: { id: FAKE_MIGO_PRODUCTS.TIKTOK, code: "06" } },
    vendorId: null, activityId: null, rucIdentificationTypeId: 1, customerGroupId: 1,
    payments: { prepaidMethodId: 3, creditMethodId: 7, creditTermId: 2 },
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase("migo_invoicing");
    prisma = new PrismaClient({ datasourceUrl: testDatabase.url });
    migo = await startFakeMigo();
    const repository = new PrismaInvoiceAuthorizationRepository(prisma as PrismaService);
    const issuer = new MigoInvoiceIssuer(new MigoApiClient({ baseUrl: migo.url, ...migo.credentials, timeoutMs: 5000 }), settings, () => now);
    authorize = new AuthorizeInvoice(repository, issuer, () => now);
    authorizePending = new AuthorizePendingInvoices(repository, issuer, authorize, () => now);
    getDocument = new GetInvoiceDocument(repository, issuer);

    await prisma.client.create({ data: { id: "migo-client", name: "Comercializadora Año Ñandú S.A.", email: "migo@example.test", ruc: "1790012345001", status: "ACTIVE", managerId: null } });
    await prisma.account.create({ data: { id: "migo-account", clientId: "migo-client", status: "ACTIVE", type: AccountType.PREPAID, creditDays: 0 } });
    for (const platform of [AdvertisingPlatform.META, AdvertisingPlatform.GOOGLE, AdvertisingPlatform.TIKTOK]) {
      await prisma.pauta.create({ data: { id: `migo-${platform}`, clientId: "migo-client", platform, status: "ACTIVE", currentBalance: new Prisma.Decimal("0") } });
    }
  });

  afterAll(async () => {
    await migo?.close();
    await prisma?.$disconnect();
    await testDatabase?.drop();
  });

  beforeEach(() => {
    migo.state.down = false;
  });

  it("emite al completar, queda esperando al SRI y el reintento la autoriza consultándola, sin emitir otra", async () => {
    const invoiceId = await completedRecharge({ META: "10.10", TIKTOK: "33.33" });

    expect(await authorize.execute({ invoiceId })).toMatchObject({ status: "SUBMITTED" });
    const submitted = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(submitted).toMatchObject({ issuer: "migo", fiscalNumber: "001-001-000000001", authorizationNumber: null, authorizationClaimedUntil: null, authorizationError: null });
    expect(submitted.externalReference).toBe(String(migo.state.invoices[0].id));

    // Lo que llegó a Migo: cliente dado de alta, dos líneas y los totales cobrados.
    expect(migo.state.customers).toEqual([expect.objectContaining({ identificationNumber: "1790012345001", socialReason: "Comercializadora Año Ñandú S.A.", email: "migo@example.test" })]);
    const sent = migo.state.invoices[0].request;
    expect(sent.details.map((line) => [line.product.id, line.subtotalAmount, line.taxAmount, line.totalAmount])).toEqual([
      [FAKE_MIGO_PRODUCTS.META, 11.62, 1.74, 13.36], [FAKE_MIGO_PRODUCTS.TIKTOK, 38.33, 5.75, 44.08],
    ]);
    expect([sent.subtotalAmount, sent.taxAmount, sent.totalAmount]).toEqual([49.95, 7.49, 57.44]);
    expect([submitted.vatBaseAmount.toString(), submitted.vatAmount.toString(), submitted.totalAmount.toString()]).toEqual(["49.95", "7.49", "57.44"]);
    expect(sent.payments).toEqual([{ amount: 57.44, paymentMethod: { id: 3 } }]);

    // El SRI aún no responde: sigue pendiente.
    expect(await authorizePending.execute()).toEqual({ authorized: 0, submitted: 1, failed: 0 });
    migo.authorizeAll();
    expect(await authorizePending.execute()).toEqual({ authorized: 1, submitted: 0, failed: 0 });

    const authorized = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(authorized.authorizationNumber).toBe(migo.state.invoices[0].accessKey);
    expect(authorized).toMatchObject({ authorizedAt: now, fiscalNumber: "001-001-000000001", documentUrl: `/files/invoices/${invoiceId}/content` });
    expect(migo.state.invoicePosts).toBe(1);
    expect(await authorizePending.execute()).toEqual({ authorized: 0, submitted: 0, failed: 0 });

    // El cliente descarga el PDF con los datos fiscales.
    const pdf = await getDocument.execute({ invoiceId, viewer: { userId: "u", role: "CLIENT", clientId: "migo-client" } });
    const text = Buffer.from(pdf.content).toString("latin1");
    expect(text).toContain("Número: 001-001-000000001");
    expect(text).toContain(`Autorización SRI: ${authorized.authorizationNumber}`);
  });

  it("con Migo caído queda pendiente con el motivo; al volver se emite una sola vez y reutiliza el cliente", async () => {
    const invoiceId = await completedRecharge({ GOOGLE: "120.00" });
    migo.state.down = true;
    const failed = await authorize.execute({ invoiceId });
    expect(failed).toMatchObject({ status: "FAILED", reason: expect.stringContaining("Migo 503") });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).toMatchObject({ externalReference: null, authorizationNumber: null, authorizationClaimedUntil: null });

    migo.state.down = false;
    const posts = migo.state.invoicePosts;
    expect(await authorizePending.execute()).toMatchObject({ submitted: 1 });
    expect(migo.state.invoicePosts).toBe(posts + 1);
    expect(migo.state.customers).toHaveLength(1);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).toMatchObject({ externalReference: expect.any(String), authorizationError: null });
  });

  it("si el token deja de valer, pide otro y sigue", async () => {
    const issued = migo.state.tokensIssued;
    migo.revokeTokens();
    migo.authorizeAll();
    expect(await authorizePending.execute()).toMatchObject({ authorized: 1, failed: 0 });
    expect(migo.state.tokensIssued).toBe(issued + 1);
  });

  it("pospago: crédito con plazo; si el SRI la rechaza guarda el motivo y el reintento solo la consulta", async () => {
    const invoiceId = await completedRecharge({ META: "500.00" }, AccountType.POSTPAID);
    expect(await authorize.execute({ invoiceId })).toMatchObject({ status: "SUBMITTED" });
    const { externalReference } = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const sent = migo.state.invoices.find((invoice) => String(invoice.id) === externalReference)!;
    expect(sent.request.payments).toEqual([{ amount: 661.25, paymentMethod: { id: 7 }, paymentTerm: { id: 2 } }]);

    migo.reject(sent.id, "IDENTIFICACION DEL COMPRADOR INVALIDA");
    const posts = migo.state.invoicePosts;
    expect(await authorizePending.execute()).toEqual({ authorized: 0, submitted: 0, failed: 1 });
    expect(migo.state.invoicePosts).toBe(posts);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).toMatchObject({
      externalReference, authorizationNumber: null, authorizationError: "El SRI no autorizó la factura: IDENTIFICACION DEL COMPRADOR INVALIDA",
    });
  });

  it("Migo acepta sin descuadres facturas de montos con redondeo difícil y varias plataformas", async () => {
    const combos: Record<string, string>[] = [
      { META: "0.01" }, { META: "0.03", GOOGLE: "0.07" }, { TIKTOK: "1.11", META: "2.22", GOOGLE: "3.33" }, { META: "19.99" },
      { GOOGLE: "45.67", TIKTOK: "89.01" }, { META: "999.95" }, { META: "1000.05", GOOGLE: "0.15", TIKTOK: "7.77" }, { TIKTOK: "12345.67" },
    ];
    const ids: string[] = [];
    for (const combo of combos) ids.push(await completedRecharge(combo));
    for (const invoiceId of ids) {
      const result = await authorize.execute({ invoiceId });
      expect(result, invoiceId).toMatchObject({ status: "SUBMITTED" });
    }
  });

  /* Una recarga completada con su factura, con los montos de AndPricingPolicy
     tal como los guarda el flujo real (detalle por plataforma, totales como suma). */
  async function completedRecharge(pautas: Partial<Record<keyof typeof AdvertisingPlatform, string>>, accountType = AccountType.PREPAID): Promise<string> {
    const id = `migo-${++counter}`;
    const details = Object.entries(pautas).map(([platform, value], index) => ({ platform, index, ...pricing.calculate(MonetaryAmount.fromMajorUnits(value!)) }));
    const total = (pick: (detail: (typeof details)[number]) => MonetaryAmount) =>
      details.map(pick).reduce((sum, value) => sum.add(value), MonetaryAmount.zero()).toMajorUnits();
    const totals = {
      pautaAmount: total((d) => d.pautaAmount), isdAmount: total((d) => d.isdAmount), agencyFeeAmount: total((d) => d.agencyCommissionAmount),
      vatBaseAmount: total((d) => d.vatBaseAmount), vatAmount: total((d) => d.vatAmount), totalAmount: total((d) => d.totalAmount),
    };
    await prisma.rechargeTransaction.create({ data: {
      id: `${id}-tx`, code: `TX-${id.toUpperCase()}`, idempotencyKey: id, clientId: "migo-client", accountId: "migo-account",
      accountTypeSnapshot: accountType, creditDaysSnapshot: accountType === AccountType.POSTPAID ? 30 : null,
      rechargeStatus: TransactionRechargeStatus.COMPLETED, completedAt: now, ...totals,
      details: { create: details.map((detail) => ({
        id: `${id}-d${detail.index}`, pautaId: `migo-${detail.platform}`, platformSnapshot: detail.platform, requestedAmount: detail.pautaAmount.toMajorUnits(),
        isdAmount: detail.isdAmount.toMajorUnits(), agencyFeeAmount: detail.agencyCommissionAmount.toMajorUnits(), vatBaseAmount: detail.vatBaseAmount.toMajorUnits(),
        vatAmount: detail.vatAmount.toMajorUnits(), totalAmount: detail.totalAmount.toMajorUnits(), status: TransactionDetailStatus.COMPLETED,
      })) },
      invoice: { create: {
        id: `${id}-inv`, invoiceNumber: `FAC-${id.toUpperCase()}`, status: "ISSUED", issuedAt: now,
        pautaSubtotal: totals.pautaAmount, isdAmount: totals.isdAmount, agencyFeeAmount: totals.agencyFeeAmount,
        vatBaseAmount: totals.vatBaseAmount, vatAmount: totals.vatAmount, totalAmount: totals.totalAmount,
      } },
    } });
    return `${id}-inv`;
  }
});
