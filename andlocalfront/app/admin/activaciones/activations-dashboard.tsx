"use client";

import { Check, RotateCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import PlatformPill from "../../components/platform-pill";
import StatusPill from "../../components/status-pill";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import type { AdvertisingPlatform } from "../../design-system/types";
import { approveActivationRequest, getAdminActivationRequests, rejectActivationRequest, reviewActivationRequest } from "../../lib/admin-recharges-api";
import { formatAmount, formatDateTime } from "../../lib/format";
import { activationStatusLabel } from "../../lib/status-labels";
import type { ActivationRequest } from "../../lib/recharges-api";
import styles from "./activations-dashboard.module.css";
import { activationStatusTone } from "../../lib/status-tone";

const clock = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });
export default function ActivationsDashboard() {
  const revision = usePlatformUpdates();
  const [items, setItems] = useState<ActivationRequest[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let active = true;
    getAdminActivationRequests()
      .then((next) => { if (active) { setError(""); setItems(next); setUpdatedAt(new Date()); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las solicitudes"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, reloadToken]);

  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    return items.filter((item) => !value || `${item.requesterName} ${item.externalAccountId} ${item.platform}`.toLowerCase().includes(value));
  }, [items, query]);

  async function act(item: ActivationRequest, action: "review" | "approve" | "reject") {
    if (action === "reject" && !reason.trim()) return;
    setBusy(item.id); setActionError(null);
    try {
      const updated = action === "review" ? await reviewActivationRequest(item.id)
        : action === "approve" ? await approveActivationRequest(item.id)
        : await rejectActivationRequest(item.id, reason);
      setItems((current) => current.map((value) => value.id === item.id ? updated : value));
      setRejecting(null); setReason("");
    } catch (cause) {
      setActionError({ id: item.id, message: cause instanceof Error ? cause.message : "No fue posible actualizar la solicitud" });
    } finally { setBusy(null); }
  }

  return <div className={styles.module}>
    <header className={styles.toolbar}>
      <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por solicitante, plataforma o ID externo" /></label>
    </header>

    <div className={styles.listMeta}>
      <span>{loading ? "consultando…" : `${visible.length} ${visible.length === 1 ? "solicitud" : "solicitudes"}${query.trim() && items.length !== visible.length ? ` de ${items.length}` : ""}`}</span>
      <span>{updatedAt ? `actualizado a las ${clock.format(updatedAt)}` : "consultando…"}</span>
    </div>

    <div className={styles.list} aria-live="polite" aria-busy={loading}>
      {!loading && !error && visible.map((item) => <article key={item.id} className={styles.row}>
        <div className={styles.cell}><strong>solicitante</strong><span className={styles.requester}>{item.requesterName}</span><span>{item.phone}</span></div>
        <div className={styles.cell}><strong>plataforma</strong><div className={styles.platformLine}><PlatformPill platform={item.platform.toLowerCase() as AdvertisingPlatform} size="compact" /></div><span>{item.kind === "REACTIVATION" ? "reactivación" : "activación"}</span></div>
        <div className={styles.cell}><strong>cuenta externa</strong><span>{item.externalAccountId}</span><span>{item.clientId}</span></div>
        <div className={styles.cell}><strong>primera recarga</strong><span className={styles.amount}>{formatAmount(item.firstRechargeAmount)}</span><span>se ejecuta al activar y validar el pago</span></div>
        <div className={styles.cell}><strong>estado</strong><StatusPill tone={activationStatusTone(item.status)}>{activationStatusLabel(item.status)}</StatusPill><span>{formatDateTime(item.createdAt)}</span></div>

        {rejecting === item.id
          ? <div className={styles.reject}>
              <label>Motivo del rechazo<textarea autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <div><button type="button" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</button><button type="button" className={styles.dangerButton} disabled={!reason.trim() || busy === item.id} onClick={() => void act(item, "reject")}><X size={16} aria-hidden="true" />Confirmar rechazo</button></div>
            </div>
          : <div className={styles.actions}>
              {item.status === "PENDING" && <button type="button" disabled={busy === item.id} onClick={() => void act(item, "review")}>Tomar para revisión</button>}
              {["PENDING", "IN_REVIEW"].includes(item.status) && <>
                <button type="button" className={styles.rejectButton} disabled={busy === item.id} onClick={() => setRejecting(item.id)}><X size={16} aria-hidden="true" />Rechazar</button>
                <button type="button" className={styles.approveButton} disabled={busy === item.id} onClick={() => void act(item, "approve")}><Check size={16} aria-hidden="true" />Activar pauta</button>
              </>}
            </div>}
        {actionError?.id === item.id && <p className={styles.rowNotice} role="alert">{actionError.message}</p>}
      </article>)}

      {loading && <><div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" /></>}
      {!loading && error && <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
        <p><strong>No se pudieron cargar las solicitudes</strong></p>
        <p>{error}</p>
        <button type="button" className={styles.retry} onClick={retry}><RotateCw size={16} aria-hidden="true" />reintentar</button>
      </div>}
      {!loading && !error && !visible.length && (
        items.length === 0
          ? <p className={styles.message}>No hay solicitudes de activación pendientes.</p>
          : <p className={styles.message}>Ninguna solicitud coincide con esa búsqueda. Hay {items.length} {items.length === 1 ? "solicitud abierta" : "solicitudes abiertas"}.</p>
      )}
    </div>
  </div>;
}
