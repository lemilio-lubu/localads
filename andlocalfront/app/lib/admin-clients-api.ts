import { authenticatedFetch } from "./auth-api";

export type AdminPlatform = "META" | "GOOGLE" | "TIKTOK";
export type AdminAccountType = "PREPAGO" | "POSTPAGO";

export type AdminClient = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  /* Gestor responsable. `null` es la bandeja de sin asignar que reparte el
     admin desde la pantalla de equipo. */
  manager: { id: string; username: string } | null;
  platformsVersion: number;
  account: {
    id: string;
    type: AdminAccountType;
    status: "ACTIVE" | "INACTIVE";
    creditDays: number;
    platforms: AdminPlatform[];
  };
  totalRecharged: number;
};

export type SaveAdminClient = {
  name: string;
  email: string;
  accountType: AdminAccountType;
  platforms: AdminPlatform[];
  creditDays: number;
  /* Solo lo aplica un admin. Un gestor se asigna a sí mismo desde el token y
     el backend ignora lo que venga aquí. */
  managerId?: string | null;
};

/* Crear un cliente crea también su acceso: la clave temporal viaja una sola
   vez, en esta respuesta, y no vuelve a salir por ningún GET. */
export type AdminClientWithCredentials = AdminClient & { credentials: { username: string; temporaryPassword: string } };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${apiUrl}${path}`, init);
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "message" in payload && payload.message ? payload.message : "No fue posible completar la operación");
  }
  return payload as T;
}

export function getAdminClients() {
  return request<AdminClient[]>("/admin/clients", { cache: "no-store" });
}

export function createAdminClient(input: SaveAdminClient) {
  return request<AdminClientWithCredentials>("/admin/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function updateAdminClient(id: string, input: Partial<SaveAdminClient> & { status?: AdminClient["status"]; expectedPlatformsVersion?: number }) {
  return request<AdminClient>(`/admin/clients/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function deactivateAdminClient(id: string) {
  return request<AdminClient>(`/admin/clients/${id}`, { method: "DELETE" });
}
