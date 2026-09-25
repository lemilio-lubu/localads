import { authenticatedFetch } from "./auth-api";

export type TeamRole = "ADMIN" | "GESTOR";

export type TeamMember = {
  id: string;
  username: string;
  role: TeamRole;
  status: "ACTIVE" | "INACTIVE";
  mustChangePassword: boolean;
  createdAt: string;
  /* Las dos cajas de la fila: cartera asignada y recargas completadas. En un
     admin salen en cero porque no lleva cartera propia. */
  metrics: { clients: number; sales: number };
};

export type TeamMemberDetail = TeamMember & {
  clients: { id: string; name: string; status: "ACTIVE" | "INACTIVE" }[];
  sales: { id: string; code: string; clientId: string; clientName: string; pautaAmount: number; totalAmount: number; createdAt: string }[];
};

/* La clave temporal llega una sola vez, aquí, y no vuelve a salir por ningún
   GET. Quien la recibe tiene que copiarla antes de cerrar el diálogo. */
export type IssuedCredentials = { username: string; temporaryPassword: string };
export type TeamMemberWithCredentials = TeamMember & { credentials: IssuedCredentials };

export type TeamFilters = { role?: TeamRole | null; status?: "ACTIVE" | "INACTIVE" | null; search?: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${apiUrl}${path}`, init);
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "message" in payload && payload.message ? payload.message : "No fue posible completar la operación");
  }
  return payload as T;
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function getTeam(filters: TeamFilters = {}) {
  const query = new URLSearchParams();
  if (filters.role) query.set("role", filters.role);
  if (filters.status) query.set("status", filters.status);
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  const suffix = query.toString();
  return request<TeamMember[]>(`/admin/team${suffix ? `?${suffix}` : ""}`, { cache: "no-store" });
}

export function getTeamMember(id: string) {
  return request<TeamMemberDetail>(`/admin/team/${id}`, { cache: "no-store" });
}

export function createTeamMember(input: { username: string; role: TeamRole }) {
  return request<TeamMemberWithCredentials>("/admin/team", { method: "POST", ...json(input) });
}

/* Al dar de baja a un gestor con cartera hay que decir a donde va: `reassignTo`
   con el gestor destino, o `leaveUnassigned` para soltarla a proposito. Sin
   ninguno de los dos el backend responde PORTFOLIO_DESTINATION_REQUIRED. */
export type PortfolioHandover = { reassignTo?: string; leaveUnassigned?: boolean };

export function updateTeamMember(id: string, input: { username?: string; role?: TeamRole; status?: "ACTIVE" | "INACTIVE" } & PortfolioHandover) {
  return request<TeamMember & { releasedClients?: number }>(`/admin/team/${id}`, { method: "PATCH", ...json(input) });
}

export function resetTeamMemberPassword(id: string) {
  return request<TeamMemberWithCredentials>(`/admin/team/${id}/password-reset`, { method: "POST" });
}

/* Vive aquí y no en admin-clients-api porque es la operación de la pantalla de
   equipo: mover un cliente de una cartera a otra. `null` lo desvincula. */
export function assignClientManager(clientId: string, managerId: string | null) {
  return request<{ id: string; name: string; manager: { id: string; username: string } | null }>(`/admin/clients/${clientId}/manager`, { method: "POST", ...json({ managerId }) });
}
