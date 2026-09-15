import { describe, expect, it } from "vitest";
import {
  AndPricingPolicy,
  DomainError,
  Invoice,
  MonetaryAmount,
  Pauta,
  PautaStatus,
  Transaction,
} from "../src/modules/recharges/domain";
import { AccountType, AdvertisingPlatform } from "../src/modules/recharges/domain/recharge.types";

const money = (amount: string) => MonetaryAmount.fromMajorUnits(amount);

function detail(id: string, pautaId: string, platform: AdvertisingPlatform, amount: string) {
  return {
    id,
    pauta: { pautaId, platform, externalAccountId: `${platform.toLowerCase()}-external` },
    requestedAmount: money(amount),
  };
}

function transaction(details: ReturnType<typeof detail>[]) {
  return Transaction.create({
    id: "transaction-001",
    code: "TX-001",
    idempotencyKey: "request-001",
    clientId: "client-001",
    accountId: "account-001",
    accountTypeSnapshot: AccountType.PREPAID,
    details,
  });
}

describe("Fase 1 - politica financiera AND", () => {
  it("calcula ISD 5%, comision 10% e IVA 15% para 100", () => {
    const result = new AndPricingPolicy().calculate(money("100.00"));

    expect(result.isdAmount.toMajorUnits()).toBe("5.00");
    expect(result.agencyCommissionAmount.toMajorUnits()).toBe("10.00");
    expect(result.vatBaseAmount.toMajorUnits()).toBe("115.00");
    expect(result.vatAmount.toMajorUnits()).toBe("17.25");
    expect(result.totalAmount.toMajorUnits()).toBe("132.25");
  });

  it("redondea half-up por componente y por detalle", () => {
    const first = new AndPricingPolicy().calculate(money("0.10"));
    const second = new AndPricingPolicy().calculate(money("0.10"));

    expect(first.isdAmount.toMajorUnits()).toBe("0.01");
    expect(first.vatAmount.toMajorUnits()).toBe("0.02");
    expect(first.totalAmount.add(second.totalAmount).toMajorUnits()).toBe("0.28");
  });
});

describe("Fase 1 - transaccion con multiples pautas", () => {
  it("crea una transaccion con tres detalles y suma sus valores financieros", () => {
    const result = transaction([
      detail("detail-meta", "pauta-meta", AdvertisingPlatform.META, "500.00"),
      detail("detail-google", "pauta-google", AdvertisingPlatform.GOOGLE, "300.00"),
      detail("detail-tiktok", "pauta-tiktok", AdvertisingPlatform.TIKTOK, "200.00"),
    ]);

    expect(result.details).toHaveLength(3);
    expect(result.totals.pautaAmount.toMajorUnits()).toBe("1000.00");
    expect(result.totals.isdAmount.toMajorUnits()).toBe("50.00");
    expect(result.totals.agencyCommissionAmount.toMajorUnits()).toBe("100.00");
    expect(result.totals.vatAmount.toMajorUnits()).toBe("172.50");
    expect(result.totals.totalAmount.toMajorUnits()).toBe("1322.50");
  });

  it("rechaza transacciones sin detalles", () => {
    expect(() => transaction([])).toThrowError(expect.objectContaining({ code: "TRANSACTION_DETAILS_REQUIRED" }));
  });

  it("rechaza la misma pauta repetida", () => {
    expect(() => transaction([
      detail("detail-1", "pauta-meta", AdvertisingPlatform.META, "10.00"),
      detail("detail-2", "pauta-meta", AdvertisingPlatform.META, "20.00"),
    ])).toThrowError(expect.objectContaining({ code: "DUPLICATE_PAUTA" }));
  });

  it("rechaza un monto de detalle igual a cero", () => {
    expect(() => transaction([
      detail("detail-1", "pauta-meta", AdvertisingPlatform.META, "0.00"),
    ])).toThrowError(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });

  it("conserva los snapshots aunque cambie el objeto usado como entrada", () => {
    const pauta = { pautaId: "pauta-meta", platform: AdvertisingPlatform.META, externalAccountId: "meta-original" };
    const result = Transaction.create({
      id: "transaction-001", code: "TX-001", idempotencyKey: "request-001",
      clientId: "client-001", accountId: "account-001", accountTypeSnapshot: AccountType.POSTPAID,
      details: [{ id: "detail-1", pauta, requestedAmount: money("100.00") }],
    });
    pauta.externalAccountId = "meta-modificada";

    expect(result.accountTypeSnapshot).toBe(AccountType.POSTPAID);
    expect(result.details[0].pautaSnapshot.externalAccountId).toBe("meta-original");
  });
});

describe("Fase 1 - pauta, saldo y factura", () => {
  it("solo permite acreditar saldo a una pauta activa y una vez por detalle", () => {
    const pauta = new Pauta({
      id: "pauta-meta", clientId: "client-001", platform: AdvertisingPlatform.META,
      externalAccountId: "meta-001", status: PautaStatus.ACTIVE,
      currentBalance: MonetaryAmount.zero(), activatedAt: new Date(), createdAt: new Date(),
    });

    pauta.recordCompletedRecharge("detail-001", money("80.00"));
    pauta.recordCompletedRecharge("detail-001", money("80.00"));

    expect(pauta.currentBalance.toMajorUnits()).toBe("80.00");
  });

  it("rechaza recargas sobre una pauta suspendida", () => {
    const pauta = new Pauta({
      id: "pauta-meta", clientId: "client-001", platform: AdvertisingPlatform.META,
      externalAccountId: "meta-001", status: PautaStatus.SUSPENDED,
      currentBalance: MonetaryAmount.zero(), activatedAt: new Date(), createdAt: new Date(),
    });

    expect(() => pauta.assertCanReceiveRecharge()).toThrowError(DomainError);
  });

  it("solo emite factura despues de completar todos los detalles", () => {
    const result = transaction([detail("detail-meta", "pauta-meta", AdvertisingPlatform.META, "100.00")]);
    expect(() => Invoice.issue("invoice-001", "FAC-001", result)).toThrowError(
      expect.objectContaining({ code: "TRANSACTION_NOT_COMPLETED" }),
    );

    result.authorize();
    result.startProcessing();
    result.completeDetail("detail-meta", money("100.00"));
    result.complete();

    const invoice = Invoice.issue("invoice-001", "FAC-001", result);
    expect(invoice.amounts.totalAmount.toMajorUnits()).toBe("132.25");
  });
});
