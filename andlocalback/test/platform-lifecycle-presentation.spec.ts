import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RolesGuard } from "../src/modules/auth/auth.guards";
import { TransactionExecutionController } from "../src/modules/recharges/presentation/transaction-execution.controller";
import { ResumeTransactionDetailDto } from "../src/modules/recharges/presentation/dto/resume-transaction-detail.dto";
import { UpdateClientDto } from "../src/modules/clients/presentation/dto/client.dto";
import { ClientsController } from "../src/modules/clients/presentation/clients.controller";

describe("contratos de baja y reanudación", () => {
  it("exige la versión al editar plataformas y acepta la baja de todas", async () => {
    expect(await validate(plainToInstance(UpdateClientDto, { platforms: [] }))).not.toEqual([]);
    expect(await validate(plainToInstance(UpdateClientDto, { platforms: [], expectedPlatformsVersion: 0 }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateClientDto, { name: "Cliente" }))).toEqual([]);
  });
  it.each([undefined, -1, "0", 1.5])("rechaza versión de reanudación inválida %s", async (expectedVersion) => {
    expect(await validate(plainToInstance(ResumeTransactionDetailDto, { expectedVersion }))).not.toEqual([]);
  });
  it("ignora actor y estado enviados por el navegador", async () => {
    const dto = plainToInstance(ResumeTransactionDetailDto, { expectedVersion: 3, administratorId: "forged", status: "COMPLETED" });
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto).toEqual({ expectedVersion: 3 });
    const execution = { resumeDetail: vi.fn().mockResolvedValue({ clientId: "client-1" }) };
    const realtime = { publishPlatforms: vi.fn() };
    const controller = new TransactionExecutionController({} as never, {} as never, {} as never, execution as never, realtime as never);
    await controller.resume("tx-1", "detail-1", { userId: "real-admin", username: "admin", role: "ADMIN" }, dto);
    expect(execution.resumeDetail).toHaveBeenCalledWith("tx-1", "detail-1", "real-admin", 3);
    expect(realtime.publishPlatforms).toHaveBeenCalledWith("client-1");
  });
  it.each([
    [TransactionExecutionController, TransactionExecutionController.prototype.resume],
    [ClientsController, ClientsController.prototype.update],
  ])("el cliente no puede invocar acciones administrativas", (controller, handler) => {
    const guard = new RolesGuard(new Reflector());
    const context = (role: string) => ({ getClass: () => controller, getHandler: () => handler, getType: () => "http", switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) }) as never;
    expect(() => guard.canActivate(context("CLIENT"))).toThrow(ForbiddenException);
    expect(guard.canActivate(context("ADMIN"))).toBe(true);
  });
});
