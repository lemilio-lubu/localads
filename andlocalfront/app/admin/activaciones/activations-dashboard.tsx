"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import PlatformPill from "../../components/platform-pill";
import StatusPill from "../../components/status-pill";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import type { AdvertisingPlatform } from "../../design-system/types";
import { approveActivationRequest, getAdminActivationRequests, rejectActivationRequest, reviewActivationRequest } from "../../lib/admin-recharges-api";
import type { ActivationRequest } from "../../lib/recharges-api";
import styles from "./activations-dashboard.module.css";

const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" });
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export default function ActivationsDashboard() {
  const revision = usePlatformUpdates();
  const [items, setItems] = useState<ActivationRequest[]>([]); const [query, setQuery] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState(""); const [rejecting, setRejecting] = useState<string | null>(null); const [reason, setReason] = useState("");
  useEffect(() => { let active = true; getAdminActivationRequests().then((next) => { if (active) setItems(next); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las solicitudes"); }); return () => { active = false; }; }, [revision]);
  const visible = useMemo(() => { const value = query.trim().toLowerCase(); return items.filter((item) => !value || `${item.requesterName} ${item.externalAccountId} ${item.platform}`.toLowerCase().includes(value)); }, [items, query]);
  async function act(item: ActivationRequest, action: "review" | "approve" | "reject") { if (action === "reject" && !reason.trim()) return; setBusy(item.id); setError(""); try { const updated = action === "review" ? await reviewActivationRequest(item.id) : action === "approve" ? await approveActivationRequest(item.id) : await rejectActivationRequest(item.id, reason); setItems((current) => current.map((value) => value.id === item.id ? updated : value)); setRejecting(null); setReason(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar la solicitud"); } finally { setBusy(null); } }
  return <div className={styles.module}>
    <header className={styles.toolbar}><label><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar solicitante, plataforma o ID externo" /></label><span>{visible.length} solicitudes</span></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.list}>{visible.map((item) => <article key={item.id} className={styles.card}>
      <header><div><PlatformPill platform={item.platform.toLowerCase() as AdvertisingPlatform} /><StatusPill>{item.kind === "REACTIVATION" ? "reactivación" : "activación"}</StatusPill><StatusPill>{label(item.status)}</StatusPill></div><time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></header>
      <div className={styles.data}><div><small>solicitante</small><strong>{item.requesterName}</strong><span>{item.phone}</span></div><div><small>ID de cuenta externa</small><strong>{item.externalAccountId}</strong><span>{item.clientId}</span></div><div><small>primera recarga</small><strong>{money.format(item.firstRechargeAmount)}</strong><span>se ejecuta después de activar y validar pago</span></div></div>
      {rejecting === item.id ? <div className={styles.reject}><label>Motivo del rechazo<textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></label><div><button type="button" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</button><button type="button" disabled={!reason.trim() || busy === item.id} onClick={() => void act(item, "reject")}><X size={16} />Confirmar rechazo</button></div></div> : <footer>{item.status === "PENDING" && <button type="button" disabled={busy === item.id} onClick={() => void act(item, "review")}>Tomar para revisión</button>}{["PENDING", "IN_REVIEW"].includes(item.status) && <><button type="button" disabled={busy === item.id} onClick={() => setRejecting(item.id)}><X size={16} />Rechazar</button><button type="button" disabled={busy === item.id} onClick={() => void act(item, "approve")}><Check size={16} />Activar pauta</button></>}</footer>}
    </article>)}{!error && visible.length === 0 && <p className={styles.empty}>No hay solicitudes de activación pendientes.</p>}</div>
  </div>;
}
