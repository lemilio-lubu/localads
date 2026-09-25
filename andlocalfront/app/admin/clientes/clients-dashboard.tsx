"use client";

import { CalendarClock, Layers, Pencil, PlusCircle, Power, RotateCw, Search, UserMinus, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import PlatformPill from "../../components/platform-pill";
import SegmentedFilter, { type SegmentOption } from "../../components/segmented-filter";
import ToggleChip from "../../components/toggle-chip";
import CredentialsModal from "../../components/credentials-modal";
import { deactivateAdminClient, getAdminClients, updateAdminClient, type AdminAccountType, type AdminClient, type AdminPlatform } from "../../lib/admin-clients-api";
import MetricCard from "../../components/metric-card";
import ClientDetailModal from "./client-detail-modal";
import ClientFormModal from "./client-form-modal";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import { getCurrentUser } from "../../lib/auth-api";
import { formatAmount } from "../../lib/format";
import styles from "./clients-dashboard.module.css";

/* Los iconos son de lucide y no SVG de marca a propósito: pintan con
   `currentColor`, así que se vuelven blancos al activarse el segmento. Un
   asset de color fijo no podría. Postpago paga después (calendario), prepago
   paga por adelantado (billetera). */
const accountTypeSegments: SegmentOption<AdminAccountType | null>[] = [
  { value: null, label: "todos", Icon: Layers, tone: "neutral" },
  { value: "POSTPAGO", label: "postpago", Icon: CalendarClock, tone: "teal" },
  { value: "PREPAGO", label: "prepago", Icon: Wallet, tone: "brand" },
];

export default function ClientsDashboard() {
  const revision = usePlatformUpdates();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<AdminPlatform | null>(null);
  const [accountType, setAccountType] = useState<AdminAccountType | null>(null);
  const [editing, setEditing] = useState<AdminClient | null>(null);
  const [selectedClient, setSelectedClient] = useState<AdminClient | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /* El filtro y el selector de gestor solo tienen sentido para el admin: la
     cartera de un gestor es, por definición, toda suya. Se lee en el render y
     no en un efecto porque AdminShell no monta esta pantalla hasta que la
     sesión está resuelta. Es presentación, no control de acceso: quien decide
     qué puede hacer cada rol es el backend. */
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  /* «sin asignar» se resuelve en el servidor: filtrar el array ya cargado
     contaba lo traido, no lo que hay. */
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [issued, setIssued] = useState<{ credentials: { username: string; temporaryPassword: string }; title: string } | null>(null);
  const hasFilters = Boolean(query.trim() || platform || accountType || unassignedOnly);
  function clearFilters() { setQuery(""); setPlatform(null); setAccountType(null); setUnassignedOnly(false); }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  /* Guardar y consultar fallan por motivos distintos: el error de la fila se
     queda junto a esa fila en vez de mezclarse con el del listado. */
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    getAdminClients(unassignedOnly ? "unassigned" : undefined).then((data) => { if (active) { setError(""); setClients(data); setSelectedClient((current) => current ? data.find((client) => client.id === current.id) ?? null : null); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar los clientes"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, reloadToken, unassignedOnly]);

  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  const visibleClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return clients.filter((client) => (!normalized || `${client.name} ${client.email} ${client.manager?.username ?? ""}`.toLowerCase().includes(normalized))
      && (!platform || client.account.platforms.includes(platform))
      && (!accountType || client.account.type === accountType)
     );
  }, [accountType, clients, platform, query]);

  function openCreate() { setEditing(null); setFormOpen(true); }
  function saveClient(client: AdminClient) {
    setClients((current) => current.some((item) => item.id === client.id)
      ? current.map((item) => item.id === client.id ? client : item)
      : [client, ...current]);
  }

  async function toggleClient(client: AdminClient) {
    setBusyClientId(client.id); setActionError(null);
    try {
      const updated = client.status === "ACTIVE"
        ? await deactivateAdminClient(client.id)
        : await updateAdminClient(client.id, { status: "ACTIVE" });
      saveClient(updated);
    } catch (reason) { setActionError({ id: client.id, message: reason instanceof Error ? reason.message : "No fue posible actualizar el cliente" }); }
    finally { setBusyClientId(null); }
  }

  return (
    <div className={styles.module}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o correo" /></label>
        <button type="button" className={styles.createButton} onClick={openCreate}><PlusCircle size={17} aria-hidden="true" />crear nuevo cliente</button>
        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <span>plataforma</span>
            {(["META", "GOOGLE", "TIKTOK"] as const).map((item) => <ToggleChip key={item} className={styles.platformFilter} pressed={platform === item} onClick={() => setPlatform((current) => current === item ? null : item)}><PlatformPill platform={item.toLowerCase() as "meta" | "google" | "tiktok"} size="filter" active={platform === item} /></ToggleChip>)}
          </div>
          {/* El tipo de cuenta es excluyente, así que se dibuja como una sola pieza
              con «todos» a la vista: antes había que deducir que se volvía a todos
              apagando el filtro que estuviera encendido. */}
          <div className={styles.filterGroup}>
            <span>tipo de cuenta</span>
            <SegmentedFilter label="Tipo de cuenta" options={accountTypeSegments} value={accountType} onChange={setAccountType} />
          </div>
          {/* Interruptor y no segmentado: la pregunta útil del admin es «¿a
              quién le falta gestor?», no repartir todos por responsable. */}
          {isAdmin && <div className={styles.filterGroup}>
            <span>gestor</span>
            <ToggleChip className={styles.managerFilter} pressed={unassignedOnly} onClick={() => setUnassignedOnly((current) => !current)}><UserMinus size={15} aria-hidden="true" />sin asignar</ToggleChip>
          </div>}
        </div>
      </div>


      {!loading && !error && visibleClients.length > 0 && <div className={styles.listMeta}>
        <span>{visibleClients.length} {visibleClients.length === 1 ? "cliente" : "clientes"}{hasFilters && clients.length !== visibleClients.length ? ` de ${clients.length}` : ""}</span>
        {hasFilters && <button type="button" className={styles.clearFiltersInline} onClick={clearFilters}>limpiar filtros</button>}
      </div>}

      <div className={styles.clientList} aria-live="polite" aria-busy={loading}>
        {visibleClients.map((client) => (
          <article key={client.id} className={`${styles.clientRow} ${client.status === "INACTIVE" ? styles.inactive : ""}`}>
            <button type="button" className={styles.openDetailButton} onClick={() => setSelectedClient(client)} aria-label={`Ver detalle de ${client.name}`} aria-haspopup="dialog" />
            <div className={styles.clientIdentity}><small>clientes</small><strong>{client.name}</strong><div>{client.account.platforms.map((item) => <PlatformPill key={item} platform={item.toLowerCase() as "meta" | "google" | "tiktok"} size="compact" />)}</div><span>{client.account.type === "POSTPAGO" ? <><b>post</b>pago</> : <><b>pre</b>pago</>}</span></div>
            <MetricCard label="recargado" tone="success">{formatAmount(client.totalRecharged)}</MetricCard>
            <MetricCard label="status">{client.status === "ACTIVE" ? "activo" : "inactivo"}</MetricCard>
            <MetricCard label="correo" valueSize="small">{client.email}</MetricCard>
            <MetricCard label="días de crédito" valueSize={client.account.type === "POSTPAGO" ? "regular" : "small"}>{client.account.type === "POSTPAGO" ? `${client.account.creditDays} días` : "no aplica"}</MetricCard>
            <MetricCard label="gestor" valueSize="small">{client.manager?.username ?? "sin asignar"}</MetricCard>
            <div className={styles.rowActions}>
              <button type="button" disabled={busyClientId === client.id} onClick={() => { setEditing(client); setFormOpen(true); }}><Pencil size={16} aria-hidden="true" />editar</button>
              <button type="button" disabled={busyClientId === client.id} onClick={() => toggleClient(client)}><Power size={16} aria-hidden="true" />{busyClientId === client.id ? "guardando…" : client.status === "ACTIVE" ? "desactivar" : "activar"}</button>
            </div>
            {actionError?.id === client.id && <p className={styles.rowNotice} role="alert">{actionError.message}</p>}
          </article>
        ))}
        {loading && <><div className={`${styles.clientRow} ${styles.skeleton}`} aria-hidden="true" /><div className={`${styles.clientRow} ${styles.skeleton}`} aria-hidden="true" /></>}
        {!loading && error && <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
          <p><strong>No se pudo cargar la lista de clientes</strong></p>
          <p>{error}</p>
          <button type="button" className={styles.retry} onClick={retry}><RotateCw size={16} aria-hidden="true" />reintentar</button>
        </div>}
        {!loading && !error && !visibleClients.length && (
          clients.length === 0
            ? <div className={styles.message}><p><strong>Todavía no hay clientes</strong></p><p>Crea el primero para empezar a registrar recargas.</p></div>
            : <div className={styles.message}>
                <p><strong>Ningún cliente coincide con estos filtros</strong></p>
                <p>Hay {clients.length} {clients.length === 1 ? "cliente registrado" : "clientes registrados"}.</p>
                <button type="button" className={styles.clearFilters} onClick={clearFilters}>limpiar filtros</button>
              </div>
        )}
      </div>

      {formOpen && <ClientFormModal client={editing} open isAdmin={isAdmin} onClose={() => setFormOpen(false)} onSaved={saveClient} onCreated={(client) => setIssued({ credentials: client.credentials, title: `acceso de ${client.name}` })} onPasswordReset={(client) => { setFormOpen(false); setIssued({ credentials: client.credentials, title: `nueva contraseña de ${client.name}` }); }} />}
      <CredentialsModal credentials={issued?.credentials ?? null} title={issued?.title ?? ""} onClose={() => setIssued(null)} />
      <ClientDetailModal key={selectedClient?.id ?? "closed"} client={selectedClient} onClose={() => setSelectedClient(null)} />
    </div>
  );
}
