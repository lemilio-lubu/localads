"use client";

import { Pencil, PlusCircle, Power, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import MetricCard from "../../components/metric-card";
import PlatformPill from "../../components/platform-pill";
import ToggleChip from "../../components/toggle-chip";
import { deactivateAdminClient, getAdminClients, updateAdminClient, type AdminAccountType, type AdminClient, type AdminPlatform } from "../../lib/admin-clients-api";
import ClientDetailModal from "./client-detail-modal";
import ClientFormModal from "./client-form-modal";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import styles from "./clients-dashboard.module.css";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(value);
}

export default function ClientsDashboard() {
  const revision = usePlatformUpdates();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<AdminPlatform | null>(null);
  const [accountType, setAccountType] = useState<AdminAccountType | null>(null);
  const [editing, setEditing] = useState<AdminClient | null>(null);
  const [selectedClient, setSelectedClient] = useState<AdminClient | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyClientId, setBusyClientId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAdminClients().then((data) => { if (active) { setClients(data); setSelectedClient((current) => current ? data.find((client) => client.id === current.id) ?? null : null); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar los clientes"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  const visibleClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return clients.filter((client) => (!normalized || `${client.name} ${client.email}`.toLowerCase().includes(normalized))
      && (!platform || client.account.platforms.includes(platform))
      && (!accountType || client.account.type === accountType));
  }, [accountType, clients, platform, query]);

  function openCreate() { setEditing(null); setFormOpen(true); }
  function saveClient(client: AdminClient) {
    setClients((current) => current.some((item) => item.id === client.id)
      ? current.map((item) => item.id === client.id ? client : item)
      : [client, ...current]);
  }

  async function toggleClient(client: AdminClient) {
    setBusyClientId(client.id);
    try {
      const updated = client.status === "ACTIVE"
        ? await deactivateAdminClient(client.id)
        : await updateAdminClient(client.id, { status: "ACTIVE" });
      saveClient(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible actualizar el cliente"); }
    finally { setBusyClientId(null); }
  }

  return (
    <div className={styles.module}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="búsqueda por clientes" /></label>
        <div className={styles.filters}><span>filtrar por</span>
          {(["META", "GOOGLE", "TIKTOK"] as const).map((item) => <ToggleChip key={item} pressed={platform === item} onClick={() => setPlatform((current) => current === item ? null : item)}><PlatformPill platform={item.toLowerCase() as "meta" | "google" | "tiktok"} /></ToggleChip>)}
          <ToggleChip className={styles.typeFilter} pressed={accountType === "POSTPAGO"} onClick={() => setAccountType((current) => current === "POSTPAGO" ? null : "POSTPAGO")}>▣ postpago</ToggleChip>
          <ToggleChip className={styles.typeFilter} pressed={accountType === "PREPAGO"} onClick={() => setAccountType((current) => current === "PREPAGO" ? null : "PREPAGO")}>▧ prepago</ToggleChip>
        </div>
      </div>

      <button type="button" className={styles.createButton} onClick={openCreate}><PlusCircle size={17} aria-hidden="true" />crear nuevo cliente</button>

      <div className={styles.clientList} aria-live="polite" aria-busy={loading}>
        {visibleClients.map((client) => (
          <article key={client.id} className={`${styles.clientRow} ${client.status === "INACTIVE" ? styles.inactive : ""}`}>
            <button type="button" className={styles.openDetailButton} onClick={() => setSelectedClient(client)} aria-label={`Ver detalle de ${client.name}`} aria-haspopup="dialog" />
            <div className={styles.clientIdentity}><small>clientes</small><strong>{client.name}</strong><div>{client.account.platforms.map((item) => <PlatformPill key={item} platform={item.toLowerCase() as "meta" | "google" | "tiktok"} size="compact" />)}</div><span>{client.account.type === "POSTPAGO" ? <><b>post</b>pago</> : <><b>pre</b>pago</>}</span></div>
            <MetricCard label="recargado" tone="success">{formatMoney(client.totalRecharged)}</MetricCard>
            <MetricCard label="status">{client.status === "ACTIVE" ? "activo" : "inactivo"}</MetricCard>
            <MetricCard label="correo" valueSize="small">{client.email}</MetricCard>
            <MetricCard label="días de crédito">{client.account.type === "POSTPAGO" ? `${client.account.creditDays} días` : "—"}</MetricCard>
            <div className={styles.rowActions}>
              <button type="button" disabled={busyClientId === client.id} onClick={() => { setEditing(client); setFormOpen(true); }}><Pencil size={16} aria-hidden="true" />editar</button>
              <button type="button" disabled={busyClientId === client.id} onClick={() => toggleClient(client)}><Power size={16} aria-hidden="true" />{busyClientId === client.id ? "guardando…" : client.status === "ACTIVE" ? "desactivar" : "activar"}</button>
            </div>
          </article>
        ))}
        {loading && <><div className={`${styles.clientRow} ${styles.skeleton}`} aria-hidden="true" /><div className={`${styles.clientRow} ${styles.skeleton}`} aria-hidden="true" /></>}
        {!loading && error && <p className={styles.message} role="alert">{error}</p>}
        {!loading && !error && !visibleClients.length && <p className={styles.message}>No hay clientes para los filtros seleccionados.</p>}
      </div>

      {formOpen && <ClientFormModal client={editing} open onClose={() => setFormOpen(false)} onSaved={saveClient} />}
      <ClientDetailModal key={selectedClient?.id ?? "closed"} client={selectedClient} onClose={() => setSelectedClient(null)} />
    </div>
  );
}
