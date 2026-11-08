import { AsyncLocalStorage } from "node:async_hooks";

/* Lo que se sabe de la peticion en curso, disponible en cualquier punto del
   codigo que corra por ella (un servicio, un adaptador, el logger) sin pasarlo
   de mano en mano. Fuera de una peticion -un runner programado, un test- no
   hay contexto y todo lee null. */
export type RequestContextState = {
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /* Lo pone JwtAuthGuard al autenticar; antes, o en una ruta publica, es null. */
  userId: string | null;
};

const storage = new AsyncLocalStorage<RequestContextState>();

export const RequestContext = {
  run<T>(state: RequestContextState, callback: () => T): T { return storage.run(state, callback); },
  current(): RequestContextState | undefined { return storage.getStore(); },
  setUser(userId: string) { const state = storage.getStore(); if (state) state.userId = userId; },
};
