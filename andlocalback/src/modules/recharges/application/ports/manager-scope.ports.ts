import { ManagerScope } from "../../../../common/access/manager-scope";
import { ApplicationError } from "../../../../common/errors/application.error";

/* Las decisiones administrativas -aprobar una verificacion, activar una pauta,
   ejecutar una recarga- reciben un id suelto. Antes de tocar nada hay que
   saber si ese registro cae dentro de la cartera de quien decide.

   Cada consulta es un findFirst recortado por la relacion con el cliente: si
   no aparece, el caso de uso ni se ejecuta. */
export interface ManagerScopeQueryPort {
  ownsTransaction(transactionId: string, managerId: string): Promise<boolean>;
  ownsVerification(verificationId: string, managerId: string): Promise<boolean>;
  ownsActivationRequest(requestId: string, managerId: string): Promise<boolean>;
  ownsReceipt(receiptId: string, managerId: string): Promise<boolean>;
}

export const MANAGER_SCOPE_QUERY = Symbol("MANAGER_SCOPE_QUERY");

/* Un registro fuera de la cartera responde 404 con el mismo codigo que uno
   inexistente. Un 403 confirmaria que existe y de quien es. */
export class AssertManagerScope {
  constructor(private readonly queries: ManagerScopeQueryPort) {}

  transaction(transactionId: string, scope: ManagerScope) {
    return this.check(scope, (managerId) => this.queries.ownsTransaction(transactionId, managerId), "TRANSACTION_NOT_FOUND", "La transaccion no existe");
  }

  verification(verificationId: string, scope: ManagerScope) {
    return this.check(scope, (managerId) => this.queries.ownsVerification(verificationId, managerId), "VERIFICATION_NOT_FOUND", "La verificacion no existe");
  }

  activationRequest(requestId: string, scope: ManagerScope) {
    return this.check(scope, (managerId) => this.queries.ownsActivationRequest(requestId, managerId), "ACTIVATION_REQUEST_NOT_FOUND", "La solicitud de activacion no existe");
  }

  receipt(receiptId: string, scope: ManagerScope) {
    return this.check(scope, (managerId) => this.queries.ownsReceipt(receiptId, managerId), "RECEIPT_NOT_FOUND", "El comprobante no existe");
  }

  /* Un admin no lleva recorte, asi que ni siquiera se consulta la base: la
     comprobacion no cuesta nada en el camino mas frecuente. */
  private async check(scope: ManagerScope, owns: (managerId: string) => Promise<boolean>, code: string, message: string) {
    if (!scope.managerId) return;
    if (!(await owns(scope.managerId))) throw new ApplicationError(code, message, 404);
  }
}
