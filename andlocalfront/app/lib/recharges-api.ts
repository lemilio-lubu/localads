import { authenticatedFetch, getCurrentUser } from "./auth-api";

export type RechargePlatform = "META" | "GOOGLE" | "TIKTOK";
export type AccountMode = "prepago" | "flex";

export type PautaResponse = { id: string; platform: RechargePlatform; externalAccountId: string | null; status: "PENDING_ACTIVATION" | "ACTIVE" | "INACTIVE" | "SUSPENDED"; currentBalance: number; activatedAt: string | null; lastRechargeAt: string | null };
export type WalletResponse = { balanceTotal: number; pautas: PautaResponse[] };
export type TransactionListItem = { pausedDetails?: number; id: string; code: string; clientId: string; clientName: string; accountId: string; accountTypeSnapshot: "PREPAGO" | "POSTPAGO"; rechargeStatus: string; paymentStatus: string | null; pautaAmount: number; totalAmount: number; platforms: RechargePlatform[]; dueDate: string | null; createdAt: string };
export type TransactionDetail = { version?: number; pausedAt?: string | null; pautaStatus?: PautaResponse["status"]; id: string; pautaId: string; platform: RechargePlatform; externalAccountId: string | null; requestedAmount: number; isdAmount: number; agencyFeeAmount: number; vatBaseAmount: number; vatAmount: number; totalAmount: number; effectiveRechargeAmount: number | null; status: string; effectiveRechargeDate: string | null; completedAt: string | null };
export type ClientTransactionDetail = { id: string; code: string; clientId: string; accountId: string; accountTypeSnapshot: "PREPAGO" | "POSTPAGO"; creditDaysSnapshot: number | null; rechargeStatus: string; pautaAmount: number; isdAmount: number; agencyFeeAmount: number; vatBaseAmount: number; vatAmount: number; totalAmount: number; completedAt: string | null; createdAt: string; details: TransactionDetail[]; payment: null | { id: string; status: string; expectedAmount: number; confirmedAmount: number | null; dueDate: string | null; confirmedAt: string | null; createdAt: string; receipts: Array<{ id: string; originalName: string; mimeType: string; size: number; url: string; status: string; createdAt: string }> }; verification: null | { status: string; reviewReason: string | null; updatedAt: string }; invoice: null | { id: string; invoiceNumber: string; status: string; issuedAt: string; pautaSubtotal: number; isdAmount: number; agencyFeeAmount: number; vatBaseAmount: number; vatAmount: number; totalAmount: number; documentUrl: string | null } };
export type PageResponse<T> = { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number };
export type CreatedTransaction = { id: string; code: string; clientId: string; accountId: string; accountTypeSnapshot: "PREPAGO" | "POSTPAGO"; status: string; createdAt: string; totals: { pautaAmount: number; isdAmount: number; agencyCommissionAmount: number; vatBaseAmount: number; vatAmount: number; totalAmount: number }; details: Array<{ id: string; pautaId: string; platform: RechargePlatform; requestedAmount: number; totalAmount: number; status: string }>; payment: { id: string; status: string; expectedAmount: number; dueDate: string | null }; receipt?: { id: string; originalName: string; status?: string } };
export type ActivationRequest = { kind?: "ACTIVATION" | "REACTIVATION"; id: string; clientId: string; platform: RechargePlatform; requesterName: string; externalAccountId: string; phone: string; firstRechargeAmount: number; status: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED"; rejectionReason: string | null; pautaId: string | null; createdAt: string; updatedAt: string };
export type RechargeLineInput = { pautaId: string; platform: RechargePlatform; amount: number };
export type RechargeContext = {
  account: { id: string; type: "PREPAGO" | "POSTPAGO"; creditDays: number; creditLimit: number; creditUsed: number; creditAvailable: number };
  rates: { isd: number; agencyFee: number; vat: number };
  pautas: PautaResponse[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
export const transactionsRealtimeUrl = process.env.NEXT_PUBLIC_WS_URL ?? `${new URL(apiUrl).origin}/transactions`;

export function accountContext(mode: AccountMode) {
  const authenticated = getCurrentUser();
  return mode === "prepago"
    ? { clientId: authenticated?.clientId ?? "", accountId: authenticated?.accountId ?? process.env.NEXT_PUBLIC_PREPAID_ACCOUNT_ID ?? "account-prepaid-001" }
    : { clientId: authenticated?.clientId ?? "", accountId: authenticated?.accountId ?? process.env.NEXT_PUBLIC_POSTPAID_ACCOUNT_ID ?? "account-postpaid-001" };
}

function newIdempotencyKey() { return `web-${Date.now()}-${crypto.randomUUID()}`; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${apiUrl}${path}`, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null;
    throw new Error(Array.isArray(message) ? message.join(". ") : message || "No fue posible completar la operación");
  }
  return payload as T;
}

export const getMyPautas = (clientId?: string) => { void clientId; return api<PautaResponse[]>("/me/pautas"); };
export const getRechargeContext = () => api<RechargeContext>("/me/recharge-context");
export function uploadPaymentReceipt(paymentId: string, receipt: File) {
  const body = new FormData();
  body.append("receipt", receipt);
  return api<{ id: string; originalName: string; status: string }>(`/payments/${encodeURIComponent(paymentId)}/receipts`, { method: "POST", body });
}
export const getMyWallet = (clientId?: string) => { void clientId; return api<WalletResponse>("/me/wallet"); };
export const getMyTransactions = (_clientId?: string, page = 1, limit = 50) => api<PageResponse<TransactionListItem>>(`/me/transactions?page=${page}&limit=${limit}`);
export const getMyTransactionDetail = (_clientId: string | undefined, transactionId: string) => api<ClientTransactionDetail>(`/me/transactions/${encodeURIComponent(transactionId)}`);

export function createPrepaidTransaction(accountId: string, details: RechargeLineInput[], receipt: File) {
  const body = new FormData();
  body.append("accountId", accountId);
  body.append("details", JSON.stringify(details.map((detail) => ({ ...detail, amount: detail.amount.toFixed(2) }))));
  body.append("receipt", receipt);
  return api<CreatedTransaction>("/transactions/prepaid", { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() }, body });
}

export const createPostpaidTransaction = (accountId: string, details: RechargeLineInput[]) => api<CreatedTransaction>("/transactions/postpaid", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey() }, body: JSON.stringify({ accountId, details: details.map((detail) => ({ ...detail, amount: detail.amount.toFixed(2) })) }) });

export const createActivationRequest = (input: { accountId: string; platform: RechargePlatform; requesterName: string; externalAccountId: string; phone: string; firstRechargeAmount: number }) => api<ActivationRequest>("/campaign-activation-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, firstRechargeAmount: input.firstRechargeAmount.toFixed(2) }) });
export const getActivationRequests = (accountId: string) => api<ActivationRequest[]>(`/campaign-activation-requests?accountId=${encodeURIComponent(accountId)}`);
export function resolveApiAssetUrl(path: string) {
  if (path.startsWith("/uploads/receipts/")) return `${apiUrl}/files/receipts/${encodeURIComponent(path.split("/").at(-1) ?? "")}`;
  return new URL(path, new URL(apiUrl).origin).toString();
}
