import type { ActivationRequest, ClientTransactionDetail, PageResponse, RechargePlatform, TransactionListItem } from "./recharges-api";
import { authenticatedFetch } from "./auth-api";

export type VerificationStatus = "EN_REVISION" | "VERIFICADA_AUTOMATICAMENTE" | "APROBADA" | "RECHAZADA";
export type VerificationScope = "ALL" | "REVIEW" | "APPROVED" | "REJECTED";
export type PendingVerification = { id: string; transactionId: string; transactionCode: string; clientId: string; clientName: string; status: VerificationStatus; reviewReason: string | null; requestedPautaAmount: number; expectedTransferAmount: number; detectedTransferAmount: number | null; amountDifference: number | null; amountMatches: boolean | null; bank: string | null; bankReference: string | null; confidence: number | null; issues: string[]; receiptId: string; receiptContentUrl: string; receiptMimeType: string; decidedAt: string | null; decidedBy: string | null; decidedByName: string | null; createdAt: string };
export type AdminVerification = { id: string; status: VerificationStatus; reviewReason: string | null; updatedAt?: string; expectedAmount: number; detectedAmount: number | null; amountMatches: boolean | null; issues: string[]; requiresManualReview: boolean; decidedBy: string | null; decidedAt: string | null; decisionNotes: string | null; rejectionReason: string | null; decisionAudit: null | { previousStatus: string; resultingStatus: string; decision: "APPROVE" | "REJECT" | "REVIEW"; administratorUserId: string; notes: string | null; reviewReason: string | null; rejectionReason: string | null; createdAt: string }; receipt: { id: string; originalName: string; mimeType: string; size: number; url: string; status: string; checksum: string; createdAt: string }; ocr: null | { id: string; bank: string | null; detectedAmount: number | null; detectedDate: string | null; transactionCode: string | null; originator: string | null; confidence: number | null; rawText: string | null; failureReason: string | null; createdAt: string }; createdAt: string };
export type AdminTransactionDetail = ClientTransactionDetail & { clientName: string; verifications: AdminVerification[] };
export type AdminTransactionFilters = { owner?: "unassigned"; page?: number; limit?: number; search?: string; clientId?: string; accountType?: "PREPAGO" | "POSTPAGO"; rechargeStatus?: string; paymentStatus?: string; from?: string; to?: string };
/* Los totales vienen del servidor y describen el filtro entero, no la página:
   sumarlos en el navegador haría que el resumen contradijera al listado. */
export type AdminTransactionPage = PageResponse<TransactionListItem> & { totals: { pautaAmount: number; totalAmount: number } };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${apiUrl}${path}`, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) { const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null; throw new Error(Array.isArray(message) ? message.join(". ") : message || "No fue posible completar la operación"); }
  return payload as T;
}

function queryString(filters: Record<string, string | number | undefined>) { const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); }); const query = params.toString(); return query ? `?${query}` : ""; }

export const getAdminTransactionsPage = (filters: AdminTransactionFilters = {}) => request<AdminTransactionPage>(`/admin/transactions${queryString(filters)}`);
export const getAdminTransactionDetail = (id: string) => request<AdminTransactionDetail>(`/admin/transactions/${encodeURIComponent(id)}`);
/* Ejecución de la recarga. El backend ya tenía los tres pasos con su guard de
   ADMIN; lo que faltaba era que alguien los llamara. El saldo de la pauta solo
   se mueve al completar cada detalle, con el monto que de verdad se recargó. */
export const startTransactionRecharge = (transactionId: string) => request<unknown>(`/transactions/${encodeURIComponent(transactionId)}/start`, { method: "POST" });
export const completeTransactionDetail = (transactionId: string, detailId: string, effectiveAmount: string) => request<unknown>(`/transactions/${encodeURIComponent(transactionId)}/details/${encodeURIComponent(detailId)}/complete`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effectiveAmount }) });
export const completeTransaction = (transactionId: string) => request<unknown>(`/transactions/${encodeURIComponent(transactionId)}/complete`, { method: "POST" });
export const resumeTransactionDetail = (transactionId: string, detailId: string, expectedVersion: number) => request<unknown>(`/transactions/${encodeURIComponent(transactionId)}/details/${encodeURIComponent(detailId)}/resume`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion }) });
export const getAdminVerifications = (filters: { owner?: "unassigned"; page?: number; limit?: number; scope?: VerificationScope; status?: VerificationStatus; search?: string; clientId?: string; bank?: string; from?: string; to?: string } = {}) => request<PageResponse<PendingVerification>>(`/admin/verifications${queryString(filters)}`);
export const approveVerification = (id: string, notes?: string) => request<unknown>(`/transaction-verifications/${encodeURIComponent(id)}/approve`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(notes?.trim() ? { notes: notes.trim() } : {}) }) });
export const markVerificationUnderReview = (id: string, reason: string) => request<unknown>(`/transaction-verifications/${encodeURIComponent(id)}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) });

export async function getAdminActivationRequests(status?: ActivationRequest["status"], owner?: "unassigned"): Promise<ActivationRequest[]> {
  if (status) return request<ActivationRequest[]>(`/admin/campaign-activation-requests${queryString({ status, owner })}`);
  const [pending, review] = await Promise.all([getAdminActivationRequests("PENDING", owner), getAdminActivationRequests("IN_REVIEW", owner)]);
  return [...pending, ...review].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const reviewActivationRequest = (id: string) => request<ActivationRequest>(`/admin/campaign-activation-requests/${encodeURIComponent(id)}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
export const approveActivationRequest = (id: string) => request<ActivationRequest>(`/admin/campaign-activation-requests/${encodeURIComponent(id)}/approve`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
export const rejectActivationRequest = (id: string, reason: string) => request<ActivationRequest>(`/admin/campaign-activation-requests/${encodeURIComponent(id)}/reject`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) });

export type { RechargePlatform };
