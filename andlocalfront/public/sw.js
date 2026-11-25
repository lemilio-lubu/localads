const CACHE_NAME = "andlocal-pwa-v1";
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("andlocal-pwa-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/* Datos de cuenta, páginas y llamadas de API nunca se guardan en caché. Solo
   se muestra una página neutral cuando no hay conexión y se navega. */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(request).catch(async () => {
    const offline = await caches.match(OFFLINE_PAGE);
    return offline || Response.error();
  }));
});

/* Avisos push. El texto llega mínimo (sin importes ni datos de la cuenta): el
   detalle se ve al abrir la app, ya con sesión. Solo se abren rutas propias. */
const safePath = (value) => (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/");

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title : "AND Local Ads";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: safePath(data.url) },
  }));
});

/* Enfoca una pestaña de la app si ya hay una abierta (y la lleva al caso);
   si no, abre una nueva. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate(target).catch(() => undefined);
    }
    return self.clients.openWindow(target);
  }));
});
