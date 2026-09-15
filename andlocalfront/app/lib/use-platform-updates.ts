"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { getAccessToken, refreshSession } from "./auth-api";
import { transactionsRealtimeUrl } from "./recharges-api";

/** Invalidate queries on changes, reconnect and focus; polling recovers lost events. */
export function usePlatformUpdates() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const socket = io(transactionsRealtimeUrl, { autoConnect: false, auth: { accessToken: getAccessToken() } });
    const refresh = () => { if (active && document.visibilityState === "visible") setRevision((value) => value + 1); };
    const authenticate = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const user = await refreshSession();
        if (active && user) { socket.auth = { accessToken: getAccessToken() }; socket.connect(); }
      } catch { /* Requests expose errors; the next focus/poll also recovers data. */ }
      finally { refreshing = false; }
    };
    socket.on("platforms:changed", refresh);
    socket.on("connect", refresh);
    socket.on("connect_error", () => { void authenticate(); });
    socket.io.on("reconnect_attempt", () => { socket.auth = { accessToken: getAccessToken() }; });
    if (getAccessToken()) socket.connect(); else void authenticate();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => { active = false; socket.disconnect(); window.clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return revision;
}
