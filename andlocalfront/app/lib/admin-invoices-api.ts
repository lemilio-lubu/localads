import { apiErrorMessage } from "./api-error";
import { authenticatedFetch } from "./auth-api";

/* Facturas que siguen sin autorizar. FAILING: el último intento falló y hay un
   motivo; WAITING_SRI: Migo la tiene y falta el SRI; QUEUED: recién creada. */
export type UnissuedInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  transactionCode: string;
  clientName: string;
  totalAmount: string;
  fiscalNumber: string | null;
  reason: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  state: "FAILING" | "WAITING_SRI" | "QUEUED";
  createdAt: string;
  pendingHours: number;
};

export type InvoiceRetryResult = {
  status: "AUTHORIZED" | "SUBMITTED" | "ALREADY_AUTHORIZED" | "IN_PROGRESS" | "MANUAL" | "DISABLED" | "FAILED";
  reason?: string;
};

const apiUrl = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${apiUrl}${path}`, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) throw new Error(apiErrorMessage(response, payload, "No fue posible completar la operación"));
  return payload as T;
}

export function getUnissuedInvoices() {
  return request<UnissuedInvoice[]>("/admin/invoices/unauthorized");
}

/* Pide la autorización en el momento, sin esperar al siguiente intento. */
export function retryInvoice(invoiceId: string) {
  return request<InvoiceRetryResult>(`/admin/invoices/${encodeURIComponent(invoiceId)}/retry`, { method: "POST" });
}
