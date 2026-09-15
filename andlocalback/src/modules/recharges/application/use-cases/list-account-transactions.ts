import { ApplicationError } from "../../../../common/errors/application.error";
import { AccountRepository, TransactionQueryRepository } from "../ports/recharge.ports";

export class ListAccountTransactions {
  constructor(private readonly accounts: AccountRepository, private readonly transactions: TransactionQueryRepository) {}

  async execute(accountId?: string) {
    if (!accountId) return this.transactions.listAll();
    if (!await this.accounts.findById(accountId)) throw new ApplicationError("ACCOUNT_NOT_FOUND", "La cuenta no existe", 404);
    return this.transactions.listByAccount(accountId);
  }
}
