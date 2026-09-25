import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ROLES_KEY } from "../../auth/auth.decorators";
import { TransactionVerificationsController } from "./transaction-verifications.controller";

/**
 * Quien puede decidir sobre una verificacion de pago.
 *
 * Aprobar deja el pago en PAID y, en PREPAGO, la recarga en APPROVED: es el
 * momento en que se declara recibido el dinero y se libera la ejecucion.
 * Estuvo reservado a ADMIN (4d38f6e) y se reabrio al gestor por decision de
 * negocio. El gestor decide solo dentro de su cartera: eso lo comprueba el
 * controller con AssertManagerScope antes del caso de uso, y lo cubren los
 * tests de alcance.
 *
 * El test lee el decorador real del controller en vez de repetir la regla en
 * prosa: si alguien cambia quien aprueba, falla aqui.
 */
const rolesOf = (method: keyof TransactionVerificationsController): readonly string[] =>
  Reflect.getMetadata(ROLES_KEY, TransactionVerificationsController.prototype[method] as object) ?? [];

describe("verificaciones de pago · quien decide", () => {
  it("aprobar lo hacen el admin y el gestor, y nadie mas", () => {
    expect(rolesOf("approve")).toEqual(["ADMIN", "GESTOR"]);
  });

  it("el gestor instruye, tria y rechaza", () => {
    expect(rolesOf("processOrRetryOcr")).toContain("GESTOR");
    expect(rolesOf("review")).toContain("GESTOR");
    expect(rolesOf("reject")).toContain("GESTOR");
  });

  it("subir el comprobante sigue siendo del cliente", () => {
    expect(rolesOf("addPaymentReceipt")).toEqual(["CLIENT"]);
  });
});
