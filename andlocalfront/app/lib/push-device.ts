import { deletePushSubscription, savePushSubscription } from "./push-api";

/* El push de este navegador. El permiso se pide solo cuando el usuario pulsa
   «activar», nunca al cargar: un permiso pedido sin contexto se deniega y ya
   no se puede volver a preguntar. */

export type PushDeviceState =
  | "unsupported" // navegador sin push (o iPhone sin la app instalada)
  | "denied" // el usuario lo bloqueó en el navegador
  | "off"
  | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/* iPhone/iPad solo tienen push con la app instalada en la pantalla de inicio. */
export const isIosWithoutInstall = () => {
  if (typeof window === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches;
};

async function registration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentPushState(): Promise<PushDeviceState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const existing = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  return existing && Notification.permission === "granted" ? "on" : "off";
}

/* La clave VAPID llega en base64url; pushManager la quiere en bytes. */
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export async function enablePush(publicKey: string): Promise<PushDeviceState> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription()
    ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  /* Siempre se reenvía: si el dispositivo era de otra sesión, pasa a esta. */
  await savePushSubscription(subscription.toJSON());
  return "on";
}

/* Al entrar: si este navegador ya tenía los avisos activados, el dispositivo
   pasa al usuario de la sesión. Sin esto, tras cambiar de usuario la pantalla
   decía «activado» pero el push seguía llegando a la cuenta anterior. Es una
   ayuda: si falla, el usuario puede volver a activarlo a mano. */
export async function claimPushDevice(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (subscription) await savePushSubscription(subscription.toJSON());
  } catch { /* sin efecto visible: la bandeja sigue funcionando */ }
}

/* Al cerrar sesión: el dispositivo deja de recibir los avisos de esta cuenta,
   para que en un equipo compartido no le lleguen a quien venga después. Va
   antes del logout, mientras la sesión aún vale para el DELETE. */
export async function releasePushDevice(): Promise<void> {
  if (!supported()) return;
  try { await disablePush(); } catch { /* cerrar sesión no debe fallar por esto */ }
}

export async function disablePush(): Promise<PushDeviceState> {
  const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (subscription) {
    await deletePushSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return "off";
}
