import { ApplicationError } from "../../../../common/errors/application.error";
import { PaymentAccountInput, normalizePaymentAccount } from "../../domain/payment-account";
import { PaymentAccountRepository, PaymentAccountView } from "../ports/payment-account.repository";

export type UpdatePaymentAccountCommand = Readonly<{
  administratorId: string;
  account: PaymentAccountInput;
}>;

/* Cambiar a donde pagan los clientes es cosa del admin: el controller lo
   reserva por rol y aqui se exige quien lo firma para dejarlo en el historial. */
export class UpdatePaymentAccount {
  constructor(private readonly accounts: PaymentAccountRepository) {}

  async execute(command: UpdatePaymentAccountCommand): Promise<PaymentAccountView> {
    if (typeof command.administratorId !== "string" || command.administratorId.trim().length === 0) {
      throw new ApplicationError("ADMINISTRATOR_REQUIRED", "El administrador es obligatorio");
    }
    return this.accounts.saveActive(normalizePaymentAccount(command.account), command.administratorId.trim());
  }
}
