import { apiErrorMessage } from "./api-error";
import { authenticatedFetch } from "./auth-api";

/* Preferencias de avisos y dispositivos con push del usuario de la sesión. El
   backend recorta por el token; aquí no viaja ningún identificador de usuario. */
/* email null: ese aviso no se manda por correo. */
export type NotificationPreferenceGroup = { key: string; label: string; push: boolean; email: boolean | null };
export type NotificationPreferences = { pushAvailable: boolean; publicKey: string | null; emailAvailable: boolean; groups: NotificationPreferenceGroup[] };
export type NotificationChannel = "push" | "email";

const apiUrl = "/api/v1/notifications";

async function request<T>(path: string, fallback: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${apiUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) throw new Error(apiErrorMessage(response, payload, fallback));
  return payload as T;
}

export const getNotificationPreferences = () => request<NotificationPreferences>("/preferences", "No fue posible cargar tus preferencias de avisos");

export const setNotificationPreference = (key: string, channel: NotificationChannel, enabled: boolean) =>
  request<void>("/preferences", "No fue posible guardar la preferencia", { method: "PUT", body: JSON.stringify({ key, channel, enabled }) });

export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  request<void>("/push-subscriptions", "No fue posible activar los avisos en este dispositivo", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
  });

export const deletePushSubscription = (endpoint: string) =>
  request<void>("/push-subscriptions", "No fue posible desactivar los avisos en este dispositivo", { method: "DELETE", body: JSON.stringify({ endpoint }) });
