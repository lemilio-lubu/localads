import { authenticatedFetch } from "./auth-api";

/* La cuenta a la que los clientes transfieren. El backend la guarda ya
   normalizada: aquí solo se pide y se muestra. */
export type PaymentAccount = {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  holderName: string;
  holderTaxId: string;
  email: string | null;
  phone: string | null;
  updatedAt: string;
  updatedById: string | null;
};
export type PaymentAccountResponse = { account: PaymentAccount | null; reference: string | null };
export type PaymentAccountInput = { bankName: string; accountType: string; accountNumber: string; holderName: string; holderTaxId: string; email?: string; phone?: string };
export type PaymentAccountChange = {
  id: string;
  action: "CREATE" | "UPDATE";
  changedById: string;
  changedByName: string | null;
  before: Omit<PaymentAccount, "id" | "updatedAt" | "updatedById"> | null;
  after: Omit<PaymentAccount, "id" | "updatedAt" | "updatedById">;
  createdAt: string;
};

/* Como el resto de lib/*-api: por el origen del frontend; next.config.ts reenvía /api/v1 al backend. */
const apiUrl = "/api/v1";

async function request<T>(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${apiUrl}${path}`, init);
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null;
    throw new Error(Array.isArray(message) ? message.join(". ") : message || "No fue posible completar la operación");
  }
  return payload as T;
}

export const getPaymentAccount = () => request<PaymentAccountResponse>("/payment-account", { cache: "no-store" });
export const getPaymentAccountHistory = () => request<PaymentAccountChange[]>("/admin/payment-account/history?limit=10", { cache: "no-store" });
export const savePaymentAccount = (input: PaymentAccountInput) => request<PaymentAccount>("/admin/payment-account", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...input, email: input.email?.trim() || undefined, phone: input.phone?.trim() || undefined }),
});

/* Lo que se copia con «copiar todo»: las líneas que el cliente pegaría en una nota o en un mensaje. */
export function paymentAccountText(account: Omit<PaymentAccount, "id" | "updatedAt" | "updatedById">, reference: string | null) {
  return [
    account.bankName,
    `Tipo: ${account.accountType}`,
    `Número de cuenta: ${account.accountNumber}`,
    `Titular: ${account.holderName}`,
    `RUC/Identificación: ${account.holderTaxId}`,
    account.email ? `Correo: ${account.email}` : null,
    account.phone ? `Celular: ${account.phone}` : null,
    reference ? `Referencia: ${reference}` : null,
  ].filter(Boolean).join("\n");
}

/* «••••5407»: lo bastante para reconocer la cuenta sin repetir el número entero. */
export const maskedAccountNumber = (accountNumber: string) => `••••${accountNumber.slice(-4)}`;
