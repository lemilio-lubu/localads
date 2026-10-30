import { PaymentAccountRepository, PaymentAccountView } from "../ports/payment-account.repository";

export type GetPaymentAccountCommand = Readonly<{
  /* Solo lo trae el token de un cliente: admin y gestor ven la cuenta, no una referencia. */
  clientId?: string | null;
}>;

export type PaymentAccountResult = Readonly<{
  account: PaymentAccountView | null;
  reference: string | null;
}>;

/* Lo que el cliente necesita para pagar: la cuenta de destino y la referencia
   que identifica sus transferencias. Cualquier usuario autenticado puede leerla;
   la referencia sale del cliente del token, nunca de un parametro. */
export class GetPaymentAccount {
  constructor(private readonly accounts: PaymentAccountRepository) {}

  async execute(command: GetPaymentAccountCommand = {}): Promise<PaymentAccountResult> {
    const [account, reference] = await Promise.all([
      this.accounts.findActive(),
      command.clientId ? this.accounts.findClientReference(command.clientId) : Promise.resolve(null),
    ]);
    return { account, reference };
  }
}
