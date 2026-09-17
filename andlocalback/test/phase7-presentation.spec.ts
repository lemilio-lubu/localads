import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/common/errors/application.error";
import {
  TransactionPaymentStatus,
  TransactionRechargeStatus,
} from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import {
  AdminTransactionsQueryDto,
  AdminVerificationsQueryDto,
  PaginationQueryDto,
} from "../src/modules/recharges/presentation/dto/phase7-query.dto";
import {
  AdminRechargeQueriesController,
  MyRechargeQueriesController,
} from "../src/modules/recharges/presentation/phase7-query.controller";

describe("Fase 7 - DTO de consultas", () => {
  it("aplica paginacion segura por defecto y transforma numeros", async () => {
    const defaults = plainToInstance(PaginationQueryDto, {});
    const query = plainToInstance(PaginationQueryDto, { page: "2", limit: "100" });

    expect(await validate(defaults)).toEqual([]);
    expect(defaults).toEqual({ page: 1, limit: 20 });
    expect(await validate(query)).toEqual([]);
    expect(query).toEqual({ page: 2, limit: 100 });
  });

  it.each([
    { page: 0, limit: 20 },
    { page: 1.5, limit: 20 },
    { page: 1, limit: 0 },
    { page: 1, limit: 101 },
    { page: "texto", limit: 20 },
  ])("rechaza paginacion invalida %#", async (input) => {
    expect(await validate(plainToInstance(PaginationQueryDto, input))).not.toEqual([]);
  });

  it("valida estados, tipo de cuenta y fechas ISO en transacciones administrativas", async () => {
    const valid = plainToInstance(AdminTransactionsQueryDto, {
      rechargeStatus: TransactionRechargeStatus.COMPLETED,
      paymentStatus: TransactionPaymentStatus.PAID,
      accountType: AccountType.POSTPAID,
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T23:59:59.999Z",
    });
    const invalid = plainToInstance(AdminTransactionsQueryDto, {
      rechargeStatus: "DONE",
      paymentStatus: "SETTLED",
      accountType: "CASH",
      from: "ayer",
    });

    expect(await validate(valid)).toEqual([]);
    expect(await validate(invalid)).not.toEqual([]);
  });

  it("valida los filtros de verificaciones", async () => {
    const valid = plainToInstance(AdminVerificationsQueryDto, {
      status: VerificationStatus.UNDER_REVIEW,
      bank: " Banco Pichincha ",
      clientId: " client-1 ",
    });
    const invalid = plainToInstance(AdminVerificationsQueryDto, { status: "WAITING", to: "10/09/2026" });

    expect(await validate(valid)).toEqual([]);
    expect(valid.bank).toBe("Banco Pichincha");
    expect(valid.clientId).toBe("client-1");
    expect(await validate(invalid)).not.toEqual([]);
  });
});

describe("Fase 7 - endpoints de lectura", () => {
  function setup() {
    const getPautas = { execute: vi.fn(async () => []) };
    const getWallet = { execute: vi.fn(async () => ({ balanceTotal: 0, pautas: [] })) };
    const getMyTransactions = { execute: vi.fn(async () => ({ items: [] })) };
    const getMyTransactionDetail = { execute: vi.fn(async () => ({ id: "tx-1" })) };
    const listAdminTransactions = { execute: vi.fn(async () => ({ items: [] })) };
    const getAdminTransactionDetail = { execute: vi.fn(async () => ({ id: "tx-1" })) };
    const listVerifications = { execute: vi.fn(async () => ({ items: [] })) };
    const getRechargeContext = { execute: vi.fn(async () => ({ account: { id: "account-1" }, rates: {}, pautas: [] })) };

    return {
      client: new MyRechargeQueriesController(
        getPautas as never,
        getRechargeContext as never,
        getWallet as never,
        getMyTransactions as never,
        getMyTransactionDetail as never,
      ),
      admin: new AdminRechargeQueriesController(
        listAdminTransactions as never,
        getAdminTransactionDetail as never,
        listVerifications as never,
      ),
      getPautas,
      getWallet,
      getMyTransactions,
      getMyTransactionDetail,
      listAdminTransactions,
      getAdminTransactionDetail,
      listVerifications,
    };
  }

  it("obtiene pautas y billetera desde la identidad del header", async () => {
    const { client, getPautas, getWallet } = setup();

    await client.pautas(" client-1 ");
    await client.wallet("client-1");

    expect(getPautas.execute).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(getWallet.execute).toHaveBeenCalledWith({ clientId: "client-1" });
  });

  it("rechaza una consulta /me sin identidad temporal", async () => {
    const { client } = setup();
    expect(() => client.pautas(undefined)).toThrowError(ApplicationError);
    expect(() => client.wallet("client forged")).toThrowError(ApplicationError);
  });

  it("pagina las transacciones propias y aplica ownership al detalle", async () => {
    const { client, getMyTransactions, getMyTransactionDetail } = setup();

    await client.transactions("client-1", { page: 3, limit: 25 });
    await client.transactionDetail("client-1", "tx-1");

    expect(getMyTransactions.execute).toHaveBeenCalledWith({ clientId: "client-1", page: 3, pageSize: 25 });
    expect(getMyTransactionDetail.execute).toHaveBeenCalledWith({ clientId: "client-1", transactionId: "tx-1" });
  });

  it("mapea filtros administrativos sin confiar identidad de cliente", async () => {
    const { admin, listAdminTransactions } = setup();
    await admin.transactions({
      page: 2,
      limit: 50,
      clientId: "client-2",
      accountType: AccountType.PREPAID,
      rechargeStatus: TransactionRechargeStatus.APPROVED,
      paymentStatus: TransactionPaymentStatus.PAID,
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T00:00:00.000Z",
    });

    expect(listAdminTransactions.execute).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
      clientId: "client-2",
      accountType: AccountType.PREPAID,
      rechargeStatus: TransactionRechargeStatus.APPROVED,
      paymentStatus: TransactionPaymentStatus.PAID,
      dateFrom: new Date("2026-09-01T00:00:00.000Z"),
      dateTo: new Date("2026-09-10T00:00:00.000Z"),
    });
  });

  it("expone detalle administrativo y bandeja de verificaciones", async () => {
    const { admin, getAdminTransactionDetail, listVerifications } = setup();
    await admin.transactionDetail("tx-1");
    await admin.verifications({
      page: 1,
      limit: 20,
      status: VerificationStatus.UNDER_REVIEW,
      bank: "Pichincha",
      from: "2026-09-01T00:00:00.000Z",
    });

    expect(getAdminTransactionDetail.execute).toHaveBeenCalledWith({ transactionId: "tx-1" });
    expect(listVerifications.execute).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: VerificationStatus.UNDER_REVIEW,
      clientId: undefined,
      bank: "Pichincha",
      dateFrom: new Date("2026-09-01T00:00:00.000Z"),
      dateTo: undefined,
    });
  });
});
