import { apiErrorMessage } from "./api-error";
import { authenticatedFetch } from "./auth-api";

/* La bandeja del usuario de la sesión. El backend recorta por el token: aquí
   no se envía ningún identificador de usuario. */
export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};
export type NotificationPage = { items: AppNotification[]; nextCursor: string | null; unread: number };

/* Como el resto de lib/*-api: por el origen del frontend; next.config.ts reenvía /api/v1 al backend. */
const apiUrl = "/api/v1";

async function request<T>(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${apiUrl}${path}`, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) throw new Error(apiErrorMessage(response, payload, "No fue posible cargar tus avisos"));
  return payload as T;
}

export function getNotifications(options: { cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query}` : "";
  return request<NotificationPage>(`/notifications${suffix}`);
}

const markRead = (body: { ids: string[] } | { all: true }) => request<{ unread: number }>("/notifications/read", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const markNotificationRead = (id: string) => markRead({ ids: [id] });
export const markAllNotificationsRead = () => markRead({ all: true });

/* Evento del socket con el contador nuevo; el contenido se pide aparte. */
export type NotificationsChangedEvent = { unread: number };
