import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ROLES_KEY } from "../../auth/auth.decorators";
import { TransactionVerificationsController } from "./transaction-verifications.controller";

/**
 * Segregacion de funciones sobre las verificaciones de pago.
 *
 * Aprobar deja el pago en PAID y, en PREPAGO, la recarga en APPROVED: es el
 * momento en que se declara recibido el dinero y se libera la ejecucion. El
 * gestor es quien lleva la relacion comercial con ese mismo cliente, asi que
 * no puede ser quien firme el cobro de su propia cartera.
 *
 * El test lee el decorador real del controller en vez de repetir la regla en
 * prosa: si alguien vuelve a abrir `approve` a GESTOR, falla aqui.
 */
const rolesOf = (method: keyof TransactionVerificationsController): readonly string[] =>
  Reflect.getMetadata(ROLES_KEY, TransactionVerificationsController.prototype[method] as object) ?? [];

describe("verificaciones de pago · segregacion de funciones", () => {
  it("aprobar es exclusivo de ADMIN", () => {
    expect(rolesOf("approve")).toEqual(["ADMIN"]);
  });

  it("el gestor conserva lo que no mueve valor: instruir, triar y rechazar", () => {
    expect(rolesOf("processOrRetryOcr")).toContain("GESTOR");
    expect(rolesOf("review")).toContain("GESTOR");
    expect(rolesOf("reject")).toContain("GESTOR");
  });

  it("subir el comprobante sigue siendo del cliente", () => {
    expect(rolesOf("addPaymentReceipt")).toEqual(["CLIENT"]);
  });
});
