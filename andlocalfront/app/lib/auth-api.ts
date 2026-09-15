export type AuthUser = { userId: string; username: string; role: "CLIENT" | "ADMIN"; clientId: string | null; accountId: string | null; accountType: "PREPAGO" | "POSTPAGO" | null };
type AuthResponse = { accessToken: string; expiresIn: number; user: AuthUser };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
let accessToken: string | null = null; let currentUser: AuthUser | null = null; let refreshPromise: Promise<AuthUser | null> | null = null;

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { message?: string | string[] } | null;
  if (!response.ok) { const message = body && typeof body === "object" && "message" in body ? body.message : null; throw new Error(Array.isArray(message) ? message.join(". ") : message || "No fue posible autenticar la sesión"); }
  return body as T;
}
function accept(result: AuthResponse) { accessToken = result.accessToken; currentUser = result.user; return result.user; }

export async function login(username: string, password: string) {
  const response = await fetch(`${apiUrl}/auth/login`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  return accept(await payload<AuthResponse>(response));
}

export function refreshSession(): Promise<AuthUser | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${apiUrl}/auth/refresh`, { method: "POST", credentials: "include" }).then(async (response) => response.ok ? accept(await payload<AuthResponse>(response)) : null).catch(() => null).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function logout() {
  await fetch(`${apiUrl}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
  accessToken = null; currentUser = null;
}

export const getCurrentUser = () => currentUser;
export const getAccessToken = () => accessToken;

export async function openAuthenticatedFile(url: string) {
  const response = await authenticatedFetch(url);
  if (!response.ok) throw new Error("No fue posible abrir el archivo");
  const objectUrl = URL.createObjectURL(await response.blob());
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function authenticatedFetch(input: string, init: RequestInit = {}) {
  if (!accessToken && !(await refreshSession())) return new Response(JSON.stringify({ message: "Debes iniciar sesión" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${accessToken}`);
  let response = await fetch(input, { ...init, headers, credentials: "include" });
  if (response.status === 401 && await refreshSession()) { headers.set("Authorization", `Bearer ${accessToken}`); response = await fetch(input, { ...init, headers, credentials: "include" }); }
  return response;
}
