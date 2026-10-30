import { NormalizedPaymentAccount } from "../../domain/payment-account";

export type PaymentAccountView = NormalizedPaymentAccount & Readonly<{
  id: string;
  updatedAt: string;
  updatedById: string | null;
}>;

export type PaymentAccountChange = Readonly<{
  id: string;
  action: "CREATE" | "UPDATE";
  changedById: string;
  changedByName: string | null;
  before: NormalizedPaymentAccount | null;
  after: NormalizedPaymentAccount;
  createdAt: string;
}>;

export interface PaymentAccountRepository {
  /* La cuenta que ven los clientes: la activa de menor posicion. */
  findActive(): Promise<PaymentAccountView | null>;
  /* Crea o actualiza la cuenta activa y deja el cambio en el historial, todo
     en una transaccion: no puede cambiar el destino sin rastro. */
  saveActive(input: NormalizedPaymentAccount, changedById: string): Promise<PaymentAccountView>;
  history(limit: number): Promise<PaymentAccountChange[]>;
  /* La referencia que el cliente pone en sus transferencias; null si aun no la tiene. */
  findClientReference(clientId: string): Promise<string | null>;
}

export const PAYMENT_ACCOUNT_REPOSITORY = Symbol("PAYMENT_ACCOUNT_REPOSITORY");
