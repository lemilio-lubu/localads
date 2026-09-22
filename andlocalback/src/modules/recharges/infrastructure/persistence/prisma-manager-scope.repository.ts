import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { ManagerScopeQueryPort } from "../../application/ports/manager-scope.ports";

/* Cuatro consultas de existencia, todas recortadas por la misma relacion:
   el registro cuelga de un cliente, y el cliente tiene un gestor. Se pide
   solo el id porque la respuesta es un si o un no. */
@Injectable()
export class PrismaManagerScopeRepository implements ManagerScopeQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async ownsTransaction(transactionId: string, managerId: string) {
    return Boolean(await this.prisma.rechargeTransaction.findFirst({ where: { id: transactionId, client: { is: { managerId } } }, select: { id: true } }));
  }

  async ownsVerification(verificationId: string, managerId: string) {
    return Boolean(await this.prisma.transactionVerification.findFirst({ where: { id: verificationId, transaction: { is: { client: { is: { managerId } } } } }, select: { id: true } }));
  }

  async ownsActivationRequest(requestId: string, managerId: string) {
    return Boolean(await this.prisma.campaignActivationRequest.findFirst({ where: { id: requestId, client: { is: { managerId } } }, select: { id: true } }));
  }

  async ownsReceipt(receiptId: string, managerId: string) {
    return Boolean(await this.prisma.paymentReceipt.findFirst({ where: { id: receiptId, payment: { is: { transaction: { is: { client: { is: { managerId } } } } } } }, select: { id: true } }));
  }

  async managerOfClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { managerId: true } });
    return client?.managerId ?? null;
  }

  async managerOfAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { client: { select: { managerId: true } } } });
    return account?.client.managerId ?? null;
  }
}
