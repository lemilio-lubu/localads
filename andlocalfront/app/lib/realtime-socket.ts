"use client";

import { io, type Socket } from "socket.io-client";
import { getAccessToken, refreshSession } from "./auth-api";
import { transactionsRealtimeUrl } from "./recharges-api";

/* Una sola conexión por pestaña. Antes cada pantalla abría la suya (Facturas
   llegaba a tener dos) y cada una repetía la renovación del token.

   El servidor mete el socket en las salas que tocan según el JWT al
   conectar, así que no hace falta pedir suscripción. La conexión vive
   mientras alguien escuche: al salir de la última pantalla se cierra, y con
   ella las salas de ese usuario. */

type Handler = (...args: unknown[]) => void;

let socket: Socket | null = null;
let listeners = 0;
let refreshing = false;
const connectHandlers = new Set<() => void>();

function authenticate(target: Socket) {
  if (refreshing) return;
  refreshing = true;
  void refreshSession()
    .then((user) => {
      if (user && socket === target) {
        target.auth = { accessToken: getAccessToken() };
        target.connect();
      }
    })
    /* Las peticiones ya muestran sus errores; el sondeo recupera los datos. */
    .catch(() => undefined)
    .finally(() => { refreshing = false; });
}

function open(): Socket {
  if (socket) return socket;
  const created = io(transactionsRealtimeUrl, { autoConnect: false, transports: ["websocket"], auth: { accessToken: getAccessToken() } });
  created.on("connect", () => { for (const handler of connectHandlers) handler(); });
  created.on("connect_error", () => authenticate(created));
  /* El servidor corta el socket al vencer el token o la sesión, y socket.io
     no reintenta solo en ese caso: se renueva y se vuelve a entrar. */
  created.on("disconnect", (reason) => { if (reason === "io server disconnect") authenticate(created); });
  created.io.on("reconnect_attempt", () => { created.auth = { accessToken: getAccessToken() }; });
  socket = created;
  if (getAccessToken()) created.connect(); else authenticate(created);
  return created;
}

function release() {
  listeners -= 1;
  if (listeners > 0 || !socket) return;
  socket.removeAllListeners();
  socket.io.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/** Escucha un evento del servidor. Devuelve la función para dejar de escuchar. */
export function subscribeRealtime<T>(event: string, handler: (payload: T) => void): () => void {
  const target = open();
  listeners += 1;
  target.on(event, handler as unknown as Handler);
  return () => { target.off(event, handler as unknown as Handler); release(); };
}

/** Se llama en cada conexión y reconexión: sirve para recuperar lo perdido mientras no hubo socket. */
export function onRealtimeConnect(handler: () => void): () => void {
  open();
  listeners += 1;
  connectHandlers.add(handler);
  return () => { connectHandlers.delete(handler); release(); };
}
