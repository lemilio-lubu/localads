import { PaymentAccountChange, PaymentAccountRepository } from "../ports/payment-account.repository";

const DEFAULT_LIMIT = 20;

export class ListPaymentAccountHistory {
  constructor(private readonly accounts: PaymentAccountRepository) {}

  execute(limit = DEFAULT_LIMIT): Promise<PaymentAccountChange[]> {
    return this.accounts.history(Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), 50));
  }
}
