"use client";

import { useEffect, useState } from "react";
import { onRealtimeConnect, subscribeRealtime } from "./realtime-socket";

/** Invalidate queries on changes, reconnect and focus; polling recovers lost events. */
export function usePlatformUpdates() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active && document.visibilityState === "visible") setRevision((value) => value + 1); };
    const stopChanges = subscribeRealtime("platforms:changed", refresh);
    const stopConnect = onRealtimeConnect(refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      stopChanges();
      stopConnect();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return revision;
}
