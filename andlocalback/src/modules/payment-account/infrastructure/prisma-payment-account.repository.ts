import { Injectable } from "@nestjs/common";
import { PaymentAccount } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { NormalizedPaymentAccount } from "../domain/payment-account";
import { PaymentAccountChange, PaymentAccountRepository, PaymentAccountView } from "../application/ports/payment-account.repository";

const activeOrder = [{ position: "asc" as const }, { createdAt: "asc" as const }];

const snapshot = (account: NormalizedPaymentAccount): NormalizedPaymentAccount => ({
  bankName: account.bankName,
  accountType: account.accountType,
  accountNumber: account.accountNumber,
  holderName: account.holderName,
  holderTaxId: account.holderTaxId,
  email: account.email,
  phone: account.phone,
});

const toView = (record: PaymentAccount): PaymentAccountView => ({ ...snapshot(record), id: record.id, updatedAt: record.updatedAt.toISOString(), updatedById: record.updatedById });

@Injectable()
export class PrismaPaymentAccountRepository implements PaymentAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive() {
    const record = await this.prisma.paymentAccount.findFirst({ where: { active: true }, orderBy: activeOrder });
    return record ? toView(record) : null;
  }

  async saveActive(input: NormalizedPaymentAccount, changedById: string) {
    return this.prisma.$transaction(async (database) => {
      const current = await database.paymentAccount.findFirst({ where: { active: true }, orderBy: activeOrder });
      /* Guardar lo mismo no es un cambio: no toca la cuenta ni ensucia el historial. */
      if (current && JSON.stringify(snapshot(current)) === JSON.stringify(snapshot(input))) return toView(current);
      const saved = current
        ? await database.paymentAccount.update({ where: { id: current.id }, data: { ...input, updatedById: changedById } })
        : await database.paymentAccount.create({ data: { ...input, updatedById: changedById } });
      await database.paymentAccountAudit.create({
        data: {
          accountId: saved.id,
          changedById,
          action: current ? "UPDATE" : "CREATE",
          before: current ? JSON.stringify(snapshot(current)) : null,
          after: JSON.stringify(snapshot(saved)),
        },
      });
      return toView(saved);
    });
  }

  async history(limit: number): Promise<PaymentAccountChange[]> {
    const audits = await this.prisma.paymentAccountAudit.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    const authors = await this.prisma.authUser.findMany({ where: { id: { in: [...new Set(audits.map((audit) => audit.changedById))] } }, select: { id: true, username: true } });
    const names = new Map(authors.map((author) => [author.id, author.username]));
    return audits.map((audit) => ({
      id: audit.id,
      action: audit.action as "CREATE" | "UPDATE",
      changedById: audit.changedById,
      changedByName: names.get(audit.changedById) ?? null,
      before: audit.before ? (JSON.parse(audit.before) as NormalizedPaymentAccount) : null,
      after: JSON.parse(audit.after) as NormalizedPaymentAccount,
      createdAt: audit.createdAt.toISOString(),
    }));
  }

  async findClientReference(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { paymentReference: true } });
    return client?.paymentReference ?? null;
  }
}
