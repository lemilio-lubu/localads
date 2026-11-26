"use client";

import { Bell } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { popoverExitTransition, popoverTransition } from "../../design-system/motion";
import { formatAgo } from "../../lib/format";
import { getNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification, type NotificationsChangedEvent } from "../../lib/notifications-api";
import { claimPushDevice } from "../../lib/push-device";
import { onRealtimeConnect, subscribeRealtime } from "../../lib/realtime-socket";
import styles from "./notification-bell.module.css";

const PAGE_SIZE = 20;

/* Solo rutas propias: el enlace viene del backend, pero nunca debe poder
   sacar al usuario de la app. */
const safePath = (path: string | null) => (path && path.startsWith("/") && !path.startsWith("//") ? path : null);

/** Campana con contador y panel de avisos. El contador llega en vivo por el
 *  socket de la pestaña; el contenido se pide al abrir. */
export default function NotificationBell() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelTop, setPanelTop] = useState(0);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await getNotifications({ limit: PAGE_SIZE });
      setItems(page.items); setNextCursor(page.nextCursor); setUnread(page.unread); setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar tus avisos");
    } finally {
      setLoading(false);
    }
  }, []);

  /* La campana solo se monta con sesión: es el sitio para que este
     dispositivo, si tenía los avisos activados, pase al usuario actual. */
  useEffect(() => { void claimPushDevice(); }, []);

  /* El contador al entrar y tras cada reconexión (cubre lo que llegó sin socket). */
  useEffect(() => {
    const refreshCount = () => { void getNotifications({ limit: 1 }).then((page) => setUnread(page.unread)).catch(() => undefined); };
    refreshCount();
    const stopConnect = onRealtimeConnect(refreshCount);
    const stopChanges = subscribeRealtime<NotificationsChangedEvent>("notifications:changed", (event) => {
      setUnread(event.unread);
      if (openRef.current) void load();
    });
    return () => { stopConnect(); stopChanges(); };
  }, [load]);

  /* En móvil el panel ocupa el ancho de la pantalla (CSS) y se ancla justo
     bajo la campana, esté donde esté en la cabecera apilada. */
  useEffect(() => {
    if (!open) return;
    const place = () => { const rect = triggerRef.current?.getBoundingClientRect(); if (rect) setPanelTop(rect.bottom); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place); };
  }, [open]);

  /* Cerrar con Escape (devolviendo el foco) o al pulsar fuera. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await getNotifications({ cursor: nextCursor, limit: PAGE_SIZE });
      setItems((current) => [...current, ...page.items]); setNextCursor(page.nextCursor); setUnread(page.unread);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar tus avisos");
    } finally {
      setLoading(false);
    }
  }

  async function openItem(item: AppNotification) {
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt } : entry)));
      void markNotificationRead(item.id).then((result) => setUnread(result.unread)).catch(() => undefined);
    }
    const path = safePath(item.linkPath);
    setOpen(false);
    if (path) router.push(path);
  }

  async function readAll() {
    try {
      const result = await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? readAt })));
      setUnread(result.unread);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible marcar los avisos");
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);
  const label = unread > 0 ? `Avisos, ${unread} sin leer` : "Avisos";

  return (
    <div className={styles.root} ref={rootRef}>
      <button ref={triggerRef} type="button" className={styles.trigger} onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label={label} title={label}>
        <Bell size={18} strokeWidth={2} aria-hidden="true" />
        {unread > 0 && <span className={styles.badge} aria-hidden="true">{badge}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.panel}
            style={{ "--panel-anchor": `${panelTop}px` } as CSSProperties}
            role="dialog"
            aria-label="Avisos"
            initial={reduceMotion ? false : { opacity: 0, transform: "translateY(-4px)" }}
            animate={{ opacity: 1, transform: "translateY(0)" }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transform: "translateY(-4px)", transition: popoverExitTransition }}
            transition={popoverTransition}
          >
            <div className={styles.panelHeader}>
              <h2>Avisos</h2>
              {unread > 0 && <button type="button" className={styles.textAction} onClick={readAll}>marcar todo como leído</button>}
            </div>
            {error && (
              <div className={styles.error} role="alert">
                <p>{error}</p>
                <button type="button" className={styles.textAction} onClick={() => void load()}>reintentar</button>
              </div>
            )}
            {!error && items.length === 0 && (loading
              ? <p className={styles.state} aria-busy="true">Cargando avisos…</p>
              : <p className={styles.state}>No tienes avisos todavía.</p>)}
            {items.length > 0 && (
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={`${styles.item} ${item.readAt ? "" : styles.unread}`} onClick={() => void openItem(item)}>
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.text}>
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <small>{formatAgo(item.createdAt)}{item.readAt ? "" : " · sin leer"}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor && !error && (
              <button type="button" className={styles.more} onClick={() => void loadMore()} disabled={loading}>{loading ? "cargando…" : "ver anteriores"}</button>
            )}
            <Link href="/avisos" className={styles.settings} onClick={() => setOpen(false)}>ajustes de avisos</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
