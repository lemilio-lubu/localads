import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { TransactionDetailStatus, TransactionPaymentStatus, TransactionRechargeStatus } from "../src/modules/recharges/domain/model/domain-status";
import { AccountType, AdvertisingPlatform, VerificationIssue, VerificationStatus } from "../src/modules/recharges/domain/recharge.types";
import { PrismaPhase7QueryRepository } from "../src/modules/recharges/infrastructure/persistence/prisma-phase7-query.repository";

describe("persistencia de consultas fase 7", () => {
  let directory: string;
  let prisma: PrismaClient;
  let repository: PrismaPhase7QueryRepository;
  const clientA = "phase7-client-a";
  const clientB = "phase7-client-b";
  const createdAt = new Date("2026-09-10T15:00:00.000Z");

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "andlocal-phase7-"));
    const databasePath = join(directory, "phase7.db");
    copyFileSync(resolve(__dirname, "../prisma/dev.db"), databasePath);
    prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replace(/\\/g, "/")}` });
    repository = new PrismaPhase7QueryRepository(prisma as PrismaService);

    await prisma.client.createMany({ data: [
      { id: clientA, name: "Cliente Uno", email: "phase7-a@example.test", status: "ACTIVE" },
      { id: clientB, name: "Cliente Dos", email: "phase7-b@example.test", status: "ACTIVE" },
    ] });
    await prisma.account.createMany({ data: [
      { id: "phase7-account-a", clientId: clientA, status: "ACTIVE", type: AccountType.PREPAID },
      { id: "phase7-account-b", clientId: clientB, status: "ACTIVE", type: AccountType.POSTPAID, creditDays: 15 },
    ] });
    await prisma.pauta.createMany({ data: [
      { id: "phase7-meta", clientId: clientA, platform: AdvertisingPlatform.META, status: "ACTIVE", currentBalance: new Prisma.Decimal("5000") },
      { id: "phase7-google-google", clientId: clientA, platform: AdvertisingPlatform.GOOGLE, status: "ACTIVE", currentBalance: new Prisma.Decimal("1000") },
      { id: "phase7-tiktok", clientId: clientB, platform: AdvertisingPlatform.TIKTOK, status: "ACTIVE", currentBalance: new Prisma.Decimal("100") },
    ] });

    await createTransaction("phase7-tx-a1", "F7-A1", clientA, "phase7-account-a", "phase7-meta", AdvertisingPlatform.META, "500", createdAt);
    await createTransaction("phase7-tx-a2", "F7-A2", clientA, "phase7-account-a", "phase7-meta", AdvertisingPlatform.META, "200", createdAt);
    await createTransaction("phase7-tx-b1", "F7-B1", clientB, "phase7-account-b", "phase7-tiktok", AdvertisingPlatform.TIKTOK, "300", new Date("2026-09-09T15:00:00.000Z"), AccountType.POSTPAID);

    await prisma.invoice.create({ data: {
      id: "phase7-invoice", transactionId: "phase7-tx-a1", invoiceNumber: "INV-F7-001", status: "ISSUED",
      issuedAt: createdAt, pautaSubtotal: 500, isdAmount: 25, agencyFeeAmount: 5,
      vatBaseAmount: 575, vatAmount: 86.25, totalAmount: 661.25, documentUrl: "/invoices/f7.pdf",
    } });
    await prisma.paymentReceipt.create({ data: {
      id: "phase7-receipt", paymentId: "phase7-payment-a1", originalName: "pago.pdf", mimeType: "application/pdf",
      size: 1234, url: "/receipts/pago.pdf", checksum: "secret-checksum", status: "PROCESSED", createdAt,
    } });
    await prisma.ocrResult.create({ data: {
      id: "phase7-ocr", receiptId: "phase7-receipt", bank: "Banco Pichincha", detectedAmount: 661.25,
      detectedDate: createdAt, detectedTransactionCode: "BANK-F7", confidence: 0.94, rawText: "auditoria OCR", createdAt,
    } });
    await prisma.transactionVerification.create({ data: {
      id: "phase7-verification", transactionId: "phase7-tx-a1", paymentId: "phase7-payment-a1",
      receiptId: "phase7-receipt", ocrResultId: "phase7-ocr", status: VerificationStatus.UNDER_REVIEW,
      expectedAmount: 661.25, detectedAmount: 661.25, amountMatches: true,
      issues: JSON.stringify([VerificationIssue.LOW_CONFIDENCE]), requiresManualReview: true, createdAt,
    } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("lee saldos y ultima recarga desde Pauta sin una Wallet persistida", async () => {
    const pautas = await repository.listPautasByClient(clientA);
    expect(pautas.map(({ platform, currentBalance }) => ({ platform, currentBalance }))).toEqual([
      { platform: AdvertisingPlatform.GOOGLE, currentBalance: 1000 },
      { platform: AdvertisingPlatform.META, currentBalance: 5000 },
    ]);
    expect(pautas.find((pauta) => pauta.platform === AdvertisingPlatform.META)?.lastRechargeAt).toBe(createdAt.toISOString());
  });

  it("pagina deterministamente y nunca mezcla transacciones de otro cliente", async () => {
    const first = await repository.listTransactionsByClient({ clientId: clientA, page: 1, pageSize: 1 });
    const second = await repository.listTransactionsByClient({ clientId: clientA, page: 2, pageSize: 1 });
    expect(first).toMatchObject({ totalItems: 2, totalPages: 2 });
    expect(first.items[0].id).toBe("phase7-tx-a2");
    expect(second.items[0].id).toBe("phase7-tx-a1");
    expect([...first.items, ...second.items].every((item) => item.clientId === clientA)).toBe(true);
  });

  it("resuelve ownership en la consulta y el detalle cliente no expone OCR ni checksum", async () => {
    expect(await repository.findTransactionDetailByClient({ transactionId: "phase7-tx-b1", clientId: clientA })).toBeNull();
    const detail = await repository.findTransactionDetailByClient({ transactionId: "phase7-tx-a1", clientId: clientA });
    expect(detail?.invoice).toMatchObject({ invoiceNumber: "INV-F7-001", totalAmount: 661.25 });
    expect(detail?.payment?.receipts[0]).not.toHaveProperty("checksum");
    expect(detail?.verification).toEqual({
      status: VerificationStatus.UNDER_REVIEW,
      reviewReason: null,
      updatedAt: expect.any(String),
    });
    expect(detail).not.toHaveProperty("verifications");
    expect(JSON.stringify(detail)).not.toContain("auditoria OCR");
    expect(JSON.stringify(detail)).not.toContain("secret-checksum");
  });

  it("aplica filtros administrativos combinables", async () => {
    const result = await repository.listTransactions({
      page: 1, pageSize: 20, clientId: clientB, accountType: AccountType.POSTPAID,
      rechargeStatus: TransactionRechargeStatus.COMPLETED, paymentStatus: TransactionPaymentStatus.PAID,
      dateFrom: new Date("2026-09-09T00:00:00.000Z"), dateTo: new Date("2026-09-09T23:59:59.999Z"),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "phase7-tx-b1", clientName: "Cliente Dos" });
  });

  it("incluye OCR, evidencia y auditoria únicamente en el detalle admin", async () => {
    const detail = await repository.findTransactionDetail("phase7-tx-a1");
    expect(detail?.verifications[0]).toMatchObject({
      id: "phase7-verification", issues: [VerificationIssue.LOW_CONFIDENCE],
      receipt: { checksum: "secret-checksum" }, ocr: { bank: "Banco Pichincha", transactionCode: "BANK-F7" },
    });
  });

  it("lista pendientes OCR con filtros y paginación", async () => {
    const result = await repository.listVerifications({
      scope: "REVIEW",
      page: 1, pageSize: 10, clientId: clientA, bank: "Pichincha", search: "F7-A1",
      dateFrom: new Date("2026-09-10T00:00:00.000Z"), dateTo: new Date("2026-09-10T23:59:59.999Z"),
    });
    expect(result).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({
      id: "phase7-verification", transactionCode: "F7-A1", clientName: "Cliente Uno",
      bank: "Banco Pichincha", bankReference: "BANK-F7", requestedPautaAmount: 500,
      expectedTransferAmount: 661.25, detectedTransferAmount: 661.25, amountDifference: 0,
      receiptContentUrl: "/api/v1/files/receipts/phase7-receipt/content", receiptMimeType: "application/pdf",
    });
    const approved = await repository.listVerifications({ scope: "APPROVED", page: 1, pageSize: 10, clientId: clientA });
    expect(approved.totalItems).toBe(0);
  });

  async function createTransaction(
    id: string, code: string, clientId: string, accountId: string, pautaId: string,
    platform: AdvertisingPlatform, pautaAmount: string, date: Date, type = AccountType.PREPAID,
  ) {
    const pauta = new Prisma.Decimal(pautaAmount);
    const isd = pauta.mul("0.05");
    const commission = pauta.mul("0.10");
    const vatBase = pauta.add(isd).add(commission);
    const vat = vatBase.mul("0.15");
    const total = vatBase.add(vat);
    await prisma.rechargeTransaction.create({ data: {
      id, code, idempotencyKey: id, clientId, accountId, accountTypeSnapshot: type,
      rechargeStatus: TransactionRechargeStatus.COMPLETED, pautaAmount: pauta, isdAmount: isd,
      agencyFeeAmount: commission, vatBaseAmount: vatBase, vatAmount: vat, totalAmount: total,
      completedAt: date, createdAt: date,
      details: { create: {
        id: `${id}-detail`, pautaId, platformSnapshot: platform, requestedAmount: pauta,
        isdAmount: isd, agencyFeeAmount: commission, vatBaseAmount: vatBase, vatAmount: vat,
        totalAmount: total, effectiveRechargeAmount: pauta, status: TransactionDetailStatus.COMPLETED,
        effectiveRechargeDate: date, completedAt: date, createdAt: date,
      } },
      payment: { create: {
        id: `phase7-payment-${code.slice(3).toLowerCase()}`, status: TransactionPaymentStatus.PAID,
        expectedAmount: total, confirmedAmount: total, confirmedAt: date, createdAt: date,
      } },
    } });
  }
});
