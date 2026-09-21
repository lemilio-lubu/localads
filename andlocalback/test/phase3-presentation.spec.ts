import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { AssertManagerScope } from "../src/modules/recharges/application/ports/manager-scope.ports";
import { TransactionReceiptOcrDispatcher } from "../src/modules/recharges/application/services/transaction-receipt-ocr-dispatcher";
import { ApproveTransactionVerification } from "../src/modules/recharges/application/use-cases/approve-transaction-verification";
import { ProcessTransactionReceiptOcr } from "../src/modules/recharges/application/use-cases/process-transaction-receipt-ocr";
import { RejectTransactionVerification } from "../src/modules/recharges/application/use-cases/reject-transaction-verification";
import { MarkTransactionVerificationUnderReview } from "../src/modules/recharges/application/use-cases/mark-transaction-verification-under-review";
import { UploadPaymentReceipt } from "../src/modules/recharges/application/use-cases/upload-payment-receipt";
import {
  ApproveTransactionVerificationDto,
  RejectTransactionVerificationDto,
  ReviewTransactionVerificationDto,
} from "../src/modules/recharges/presentation/dto/transaction-verification-decision.dto";
import { TransactionVerificationsController } from "../src/modules/recharges/presentation/transaction-verifications.controller";
import { ROLES_KEY } from "../src/modules/auth/auth.decorators";

/* Doble que nunca recorta: equivale al alcance de un admin. */
const sinRecorte = new AssertManagerScope({ ownsTransaction: async () => true, ownsVerification: async () => true, ownsActivationRequest: async () => true, ownsReceipt: async () => true });
const administrador = { userId: "admin-1", username: "admin", role: "ADMIN" as const, clientId: null, accountId: null, accountType: null };

describe("Fase 3 - DTO de decisiones administrativas", () => {

  it("acepta notas opcionales al aprobar", async () => {
    const dto = plainToInstance(ApproveTransactionVerificationDto, {
      administratorId: "admin-001",
      notes: "Validado contra el banco",
    });
    expect(await validate(dto)).toEqual([]);
  });

  it("exige motivo al rechazar", async () => {
    const dto = plainToInstance(RejectTransactionVerificationDto, { administratorId: "admin-001" });
    expect(await validate(dto)).not.toEqual([]);
  });

  it("exige un motivo válido para enviar a revisión", async () => {
    const missing = plainToInstance(ReviewTransactionVerificationDto, { administratorId: "admin-001" });
    const tooLong = plainToInstance(ReviewTransactionVerificationDto, { reason: "x".repeat(501) });
    expect(await validate(missing)).not.toEqual([]);
    expect(await validate(tooLong)).not.toEqual([]);
  });
});

describe("Fase 3 - TransactionVerificationsController", () => {
  function setup() {
    const processOcr = { execute: vi.fn(async () => ({ id: "verification-001" })) };
    const approve = { execute: vi.fn(async () => ({ status: "APROBADA" })) };
    const reject = { execute: vi.fn(async () => ({ status: "RECHAZADA" })) };
    const review = { execute: vi.fn(async () => ({ status: "EN_REVISION" })) };
    const upload = { execute: vi.fn(async () => ({ id: "receipt-002", status: "LOADED" })) };
    const dispatcher = { dispatch: vi.fn() };
    const controller = new TransactionVerificationsController(
      processOcr as unknown as ProcessTransactionReceiptOcr,
      approve as unknown as ApproveTransactionVerification,
      reject as unknown as RejectTransactionVerification,
      upload as unknown as UploadPaymentReceipt,
      dispatcher as unknown as TransactionReceiptOcrDispatcher,
      {} as never,
      review as unknown as MarkTransactionVerificationUnderReview,
      sinRecorte,
    );
    return { controller, processOcr, approve, reject, review, upload, dispatcher };
  }

  it("expone procesamiento/reintento OCR por receiptId", async () => {
    const { controller, processOcr } = setup();
    await controller.processOrRetryOcr("receipt-001", administrador);
    expect(processOcr.execute).toHaveBeenCalledWith({ receiptId: "receipt-001" });
  });

  it("mapea aprobacion con administrador y notas", async () => {
    const { controller, approve } = setup();
    await controller.approve("verification-001", { administratorId: "admin-001", notes: "OK" });
    expect(approve.execute).toHaveBeenCalledWith({
      verificationId: "verification-001",
      administratorId: "admin-001",
      notes: "OK",
    });
  });

  it("mapea rechazo con motivo", async () => {
    const { controller, reject } = setup();
    await controller.reject("verification-001", { administratorId: "admin-001", reason: "Referencia repetida" });
    expect(reject.execute).toHaveBeenCalledWith({
      verificationId: "verification-001",
      administratorId: "admin-001",
      reason: "Referencia repetida",
    });
  });

  it("mapea la revisión con el administrador autenticado y conserva el flujo de rechazo legado", async () => {
    const { controller, review, reject } = setup();
    await controller.review(
      "verification-001",
      { administratorId: "admin-body", reason: "El banco no se pudo identificar" },
      { userId: "admin-session", username: "admin", role: "ADMIN", clientId: null, accountId: null, accountType: null },
    );
    expect(review.execute).toHaveBeenCalledWith({
      verificationId: "verification-001",
      administratorId: "admin-session",
      reason: "El banco no se pudo identificar",
    });
    expect(reject.execute).not.toHaveBeenCalled();
  });

  /* La decision la comparten admin y gestor; lo que los separa es la cartera,
     comprobada en el metodo antes de invocar el caso de uso. El cliente sigue
     fuera. */
  it("restringe la transición a revisión a los roles del portal administrativo", () => {
    expect(Reflect.getMetadata(ROLES_KEY, TransactionVerificationsController.prototype.review)).toEqual(["ADMIN", "GESTOR"]);
  });

  it("una verificación fuera de la cartera del gestor no llega al caso de uso", async () => {
    const { controller, approve } = setup();
    const gestor = { ...administrador, userId: "gestor-1", username: "gestor", role: "GESTOR" as const };
    const ajena = new TransactionVerificationsController(
      {} as never, approve as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      new AssertManagerScope({ ownsTransaction: async () => false, ownsVerification: async () => false, ownsActivationRequest: async () => false, ownsReceipt: async () => false }),
    );
    await expect(ajena.approve("verification-ajena", { administratorId: "gestor-1" }, gestor))
      .rejects.toMatchObject({ code: "VERIFICATION_NOT_FOUND", status: 404 });
    expect(approve.execute).not.toHaveBeenCalled();
    void controller;
  });

  it("carga evidencia y despacha su OCR fuera del caso de uso", async () => {
    const { controller, upload, dispatcher } = setup();
    const file = {
      originalname: "pago.pdf",
      mimetype: "application/pdf",
      size: 20,
      buffer: Buffer.from("%PDF evidence"),
    } as Express.Multer.File;
    await controller.addPaymentReceipt("payment-001", file);
    expect(upload.execute).toHaveBeenCalledWith({
      paymentId: "payment-001",
      file: {
        originalName: "pago.pdf",
        mimeType: "application/pdf",
        size: 20,
        buffer: file.buffer,
      },
    });
    expect(dispatcher.dispatch).toHaveBeenCalledWith("receipt-002");
  });

  it("rechaza la carga sin archivo antes de tocar aplicacion", async () => {
    const { controller, upload } = setup();
    await expect(controller.addPaymentReceipt("payment-001", undefined))
      .rejects.toMatchObject({ code: "RECEIPT_REQUIRED" });
    expect(upload.execute).not.toHaveBeenCalled();
  });
});
