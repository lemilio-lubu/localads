"use client";

import { Check, X, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ToggleChip from "../../components/atoms/toggle-chip";
import PlatformPill from "../../components/atoms/platform-pill";
import StatusPill from "../../components/atoms/status-pill";
import { getCurrentUser } from "../../lib/auth-api";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import type { AdvertisingPlatform } from "../../design-system/types";
import { approveActivationRequest, getAdminActivationRequests, rejectActivationRequest, reviewActivationRequest } from "../../lib/admin-recharges-api";
import { formatAmount, formatClock, formatDateTime } from "../../lib/format";
import { activationStatusLabel } from "../../lib/status-labels";
import type { ActivationRequest } from "../../lib/recharges-api";
import styles from "./activations-dashboard.module.css";
import { activationStatusTone } from "../../lib/status-tone";
import SearchField from "../../components/molecules/search-field";
import LoadError from "../../components/molecules/load-error";
import { TextArea } from "../../components/atoms/text-field";
import Button from "../../components/atoms/button";
import TruncatedText from "../../components/atoms/truncated-text";
import ListCell from "../../components/atoms/list-cell";
import TextButton from "../../components/atoms/text-button";
import { matchesSearch } from "../../lib/text-search";

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
  /* El cubo de los que no tienen gestor. Solo se le ofrece al admin: un
     gestor que lo pidiera no obtendria huerfanos ajenos sino nada, porque
     su recorte y este filtro condicionan el mismo campo. */
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [unassignedOnly, setUnassignedOnly] = useState(false);


  useEffect(() => {
    let active = true;
    getAdminActivationRequests(undefined, unassignedOnly ? "unassigned" : undefined)
      .then((next) => { if (active) { setError(""); setItems(next); setUpdatedAt(new Date()); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las solicitudes"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, reloadToken, unassignedOnly]);

  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  const visible = useMemo(() => {
    return items.filter((item) => matchesSearch(query, item.clientName, item.clientRuc, item.requesterName, item.externalAccountId, item.platform));
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
      <SearchField value={query} onChange={setQuery} placeholder="Buscar por cliente, RUC, solicitante o ID externo" placeholderTone="muted" className={styles.search} />
      <div className={styles.filters}>{isAdmin && <div className={styles.filterGroup}><span>gestor</span><ToggleChip className={styles.managerFilter} pressed={unassignedOnly} onClick={() => setUnassignedOnly((current) => !current)}><UserMinus size={15} aria-hidden="true" />sin asignar</ToggleChip></div>}</div>
    </header>

    <div className={styles.listMeta}>
      <span>{loading ? "consultando…" : `${visible.length} ${visible.length === 1 ? "solicitud" : "solicitudes"}${query.trim() && items.length !== visible.length ? ` de ${items.length}` : ""}`}</span>
      <span>{updatedAt ? `actualizado a las ${formatClock(updatedAt)}` : "consultando…"}</span>
    </div>

    <div className={styles.list} aria-live="polite" aria-busy={loading}>
      {!loading && !error && visible.map((item) => <article key={item.id} className={styles.row}>
        {/* Primero de qué cliente es: su nombre y RUC. Quien la pidió y su
            teléfono van debajo, para contactarle. */}
        <ListCell className={styles.cell} label="cliente"><TruncatedText className={styles.requester}>{item.clientName ?? "cliente sin nombre"}</TruncatedText>{item.clientRuc && <span className={styles.subtle}>RUC {item.clientRuc}</span>}<TruncatedText className={styles.subtle}>{`${item.requesterName} · ${item.phone}`}</TruncatedText></ListCell>
        <ListCell className={styles.cell} label="plataforma"><div className={styles.platformLine}><PlatformPill platform={item.platform.toLowerCase() as AdvertisingPlatform} size="compact" /></div><span className={styles.subtle}>{item.kind === "REACTIVATION" ? "reactivación" : "activación"}</span></ListCell>
        <ListCell className={styles.cell} label="cuenta externa"><TruncatedText>{item.externalAccountId}</TruncatedText></ListCell>
        <ListCell className={styles.cell} label="primera recarga"><span className={styles.amount}>{formatAmount(item.firstRechargeAmount)}</span></ListCell>
        <ListCell className={styles.cell} label="estado"><StatusPill tone={activationStatusTone(item.status)}>{activationStatusLabel(item.status)}</StatusPill>{item.reviewedByName && <TruncatedText className={styles.holder}>{`por ${item.reviewedByName}`}</TruncatedText>}
          {/* Tomar el caso no decide nada: marca quién lo lleva. Vive junto al
              estado, donde luego aparece «por …», y no entre los botones de
              decisión, donde parecía un paso obligatorio. Activar o rechazar
              funcionan igual sin tomarlo. */}
          {item.status === "PENDING" && <TextButton size="body-sm" className={styles.claim} disabled={busy === item.id} title="Marca la solicitud como tuya para que el equipo sepa que la estás revisando" onClick={() => void act(item, "review")}>tomar el caso</TextButton>}<span className={styles.subtle}>{formatDateTime(item.createdAt)}</span></ListCell>

        {rejecting === item.id
          ? <div className={styles.reject}>
              <label>Motivo del rechazo<TextArea tone="danger" autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <div><Button variant="neutral" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</Button><Button variant="danger" disabled={!reason.trim() || busy === item.id} onClick={() => void act(item, "reject")}><X size={16} aria-hidden="true" />Confirmar rechazo</Button></div>
            </div>
          : <div className={styles.actions}>
              {["PENDING", "IN_REVIEW"].includes(item.status) && <>
                <Button variant="danger-soft" disabled={busy === item.id} onClick={() => setRejecting(item.id)}><X size={16} aria-hidden="true" />Rechazar</Button>
                <Button disabled={busy === item.id} title="La primera recarga se ejecuta al activar y validar el pago" onClick={() => void act(item, "approve")}><Check size={16} aria-hidden="true" />Activar pauta</Button>
              </>}
            </div>}
        {actionError?.id === item.id && <p className={styles.rowNotice} role="alert">{actionError.message}</p>}
      </article>)}

      {loading && <><div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" /></>}
      {!loading && error && <LoadError title="No se pudieron cargar las solicitudes" message={error} frame="control" onRetry={retry} />}
      {!loading && !error && !visible.length && (
        items.length === 0
          ? <p className={styles.message}>No hay solicitudes de activación pendientes.</p>
          : <p className={styles.message}>Ninguna solicitud coincide con esa búsqueda. Hay {items.length} {items.length === 1 ? "solicitud abierta" : "solicitudes abiertas"}.</p>
      )}
    </div>
  </div>;
}
