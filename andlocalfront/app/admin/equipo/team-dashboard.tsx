"use client";

import { CirclePlus, KeyRound, Layers, Power, RotateCw, Search, Shield, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import SegmentedFilter, { type SegmentOption } from "../../components/segmented-filter";
import CredentialsModal from "../../components/credentials-modal";
import { getTeam, resetTeamMemberPassword, updateTeamMember, type IssuedCredentials, type TeamMember, type TeamRole } from "../../lib/team-api";
import TeamFormModal from "./team-form-modal";
import PortfolioHandoverModal from "./portfolio-handover-modal";
import TeamMemberModal from "./team-member-modal";
import MetricCard from "../../components/metric-card";
import styles from "./team-dashboard.module.css";

/* Mismos iconos de lucide que el resto de filtros: pintan con `currentColor`,
   así que se vuelven blancos al activarse el segmento. Un escudo para quien
   administra el sistema, un usuario con engranaje para quien lleva cartera. */
const roleSegments: SegmentOption<TeamRole | null>[] = [
  { value: null, label: "todos", Icon: Layers, tone: "neutral" },
  { value: "ADMIN", label: "admin", Icon: Shield, tone: "teal" },
  { value: "GESTOR", label: "gestor", Icon: UserCog, tone: "brand" },
];

const roleLabel = (role: TeamRole) => role === "ADMIN" ? "administrador" : "gestor";

export default function TeamDashboard() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<TeamRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [issued, setIssued] = useState<{ credentials: IssuedCredentials; title: string } | null>(null);
  /* La baja de un gestor con cartera pasa por el modal de destino. */
  const [handover, setHandover] = useState<TeamMember | null>(null);
  const [handoverError, setHandoverError] = useState("");
  /* Ficha abierta. Se refleja en la URL (?miembro=) para que el enlace a un
     miembro se pueda compartir o guardar, como cuando era una pantalla. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function openMember(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("miembro", id); else url.searchParams.delete("miembro");
    window.history.replaceState(null, "", url);
  }

  const hasFilters = Boolean(query.trim() || role);
  function clearFilters() { setQuery(""); setRole(null); }

  useEffect(() => {
    let active = true;
    getTeam().then((data) => {
      if (!active) return;
      setError(""); setMembers(data);
      /* Un enlace con ?miembro= abre esa ficha sobre la lista, ya cargada. Se
         lee aquí y no al iniciar el estado: el servidor no ve la URL del
         navegador y el HTML de los dos no coincidiría. */
      const fromUrl = new URLSearchParams(window.location.search).get("miembro");
      if (fromUrl) setSelectedId((current) => current ?? fromUrl);
    })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar el equipo"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadToken]);

  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  /* El filtro es local: el equipo es una lista corta y no merece un viaje al
     servidor por cada tecla. El endpoint acepta los mismos criterios si algún
     día crece lo bastante para necesitarlo. */
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return members.filter((member) => (!normalized || member.username.toLowerCase().includes(normalized)) && (!role || member.role === role));
  }, [members, query, role]);

  function save(member: TeamMember) {
    setMembers((current) => current.some((item) => item.id === member.id) ? current.map((item) => item.id === member.id ? member : item) : [member, ...current]);
  }

  async function confirmHandover(destination: { reassignTo?: string; leaveUnassigned?: boolean }) {
    if (!handover) return;
    setBusyId(handover.id); setHandoverError("");
    try {
      save(await updateTeamMember(handover.id, { status: "INACTIVE", ...destination }));
      setHandover(null);
      /* Cambia la cartera de dos personas a la vez, así que se recarga en vez
         de parchear los recuentos a mano. */
      setReloadToken((token) => token + 1);
    } catch (reason) {
      setHandoverError(reason instanceof Error ? reason.message : "No fue posible dar de baja la cuenta");
    } finally { setBusyId(null); }
  }

  async function run(member: TeamMember, action: "toggle" | "reset") {
    /* Dar de baja a alguien con cartera no se resuelve aquí: hay que decir a
       dónde van sus clientes. Sin cartera no hay nada que decidir y la baja
       sigue siendo un clic. */
    if (action === "toggle" && member.status === "ACTIVE" && member.metrics.clients > 0) {
      setHandoverError(""); setHandover(member); return;
    }
    setBusyId(member.id); setActionError(null);
    try {
      if (action === "toggle") {
        save(await updateTeamMember(member.id, { status: member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }));
        setReloadToken((token) => token + 1);
      } else {
        const updated = await resetTeamMemberPassword(member.id);
        save(updated);
        setIssued({ credentials: updated.credentials, title: `nueva contraseña de ${updated.username}` });
      }
    } catch (reason) {
      setActionError({ id: member.id, message: reason instanceof Error ? reason.message : "No fue posible actualizar la cuenta" });
    } finally { setBusyId(null); }
  }

  return (
    <div className={styles.module}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por usuario" /></label>
        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <span>rol</span>
            <SegmentedFilter label="Rol" options={roleSegments} value={role} onChange={setRole} />
          </div>
        </div>
      </div>

      <button type="button" className={styles.createButton} onClick={() => setFormOpen(true)}><CirclePlus size={17} aria-hidden="true" />crear cuenta</button>

      {!loading && !error && visible.length > 0 && <div className={styles.listMeta}>
        <span>{visible.length} {visible.length === 1 ? "cuenta" : "cuentas"}{hasFilters && members.length !== visible.length ? ` de ${members.length}` : ""}</span>
        {hasFilters && <button type="button" className={styles.clearFiltersInline} onClick={clearFilters}>limpiar filtros</button>}
      </div>}

      <div className={styles.list} aria-live="polite" aria-busy={loading}>
        {!loading && !error && visible.map((member) => (
          <article key={member.id} className={`${styles.row} ${member.status === "INACTIVE" ? styles.inactive : ""}`}>
            <button type="button" className={styles.openDetail} onClick={() => openMember(member.id)} aria-label={`Ver detalle de ${member.username}`} aria-haspopup="dialog" />
            <div className={styles.identity}>
              <small>usuario</small>
              <strong>{member.username}</strong>
              <span data-role={member.role}>{roleLabel(member.role)}</span>
            </div>
            {/* «no aplica» en tamaño pequeño, como en Clientes: es una ausencia,
                no una cifra, y en grande competía con los números de al lado. */}
            <MetricCard label="cuentas" valueSize={member.role === "ADMIN" ? "small" : "regular"}>{member.role === "ADMIN" ? "no aplica" : String(member.metrics.clients)}</MetricCard>
            <MetricCard label="ventas" valueSize={member.role === "ADMIN" ? "small" : "regular"}>{member.role === "ADMIN" ? "no aplica" : String(member.metrics.sales)}</MetricCard>
            <MetricCard label="estado">{member.status === "ACTIVE" ? "activo" : "inactivo"}</MetricCard>
            <MetricCard label="acceso" valueSize="small">{member.mustChangePassword ? "clave temporal" : "clave propia"}</MetricCard>
            <div className={styles.rowActions}>
              <button type="button" disabled={busyId === member.id} onClick={() => void run(member, "reset")}><KeyRound size={16} aria-hidden="true" />restablecer</button>
              <button type="button" disabled={busyId === member.id} onClick={() => void run(member, "toggle")}><Power size={16} aria-hidden="true" />{busyId === member.id ? "guardando…" : member.status === "ACTIVE" ? "desactivar" : "activar"}</button>
            </div>
            {actionError?.id === member.id && <p className={styles.rowNotice} role="alert">{actionError.message}</p>}
          </article>
        ))}

        {loading && <><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /></>}
        {!loading && error && <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
          <p><strong>No se pudo cargar el equipo</strong></p>
          <p>{error}</p>
          <button type="button" className={styles.retry} onClick={retry}><RotateCw size={16} aria-hidden="true" />reintentar</button>
        </div>}
        {!loading && !error && !visible.length && (
          members.length === 0
            ? <div className={styles.message}><p><strong>Todavía no hay cuentas internas</strong></p><p>Crea la primera para repartir la cartera de clientes.</p></div>
            : <div className={styles.message}>
                <p><strong>Ninguna cuenta coincide con estos filtros</strong></p>
                <p>Hay {members.length} {members.length === 1 ? "cuenta" : "cuentas"}.</p>
                <button type="button" className={styles.clearFilters} onClick={clearFilters}>limpiar filtros</button>
              </div>
        )}
      </div>

      <PortfolioHandoverModal
        member={handover}
        candidates={members.filter((item) => item.role === "GESTOR" && item.status === "ACTIVE" && item.id !== handover?.id)}
        pending={busyId === handover?.id}
        error={handoverError}
        onClose={() => { setHandover(null); setHandoverError(""); }}
        onConfirm={(destination) => void confirmHandover(destination)}
      />
      {/* Restablecer y dar de baja cierran la ficha y siguen por los flujos de
          la lista (credenciales, destino de cartera): un modal nunca se apila
          sobre otro. */}
      <TeamMemberModal
        key={selectedId ?? "closed"}
        memberId={selectedId}
        onClose={() => openMember(null)}
        onChanged={() => setReloadToken((token) => token + 1)}
        onResetPassword={(member) => { openMember(null); void run(member, "reset"); }}
        onToggleStatus={(member) => { openMember(null); void run(member, "toggle"); }}
      />
      <TeamFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(member) => { setFormOpen(false); save(member); setIssued({ credentials: member.credentials, title: `cuenta de ${member.username} creada` }); }} />
      <CredentialsModal credentials={issued?.credentials ?? null} title={issued?.title ?? ""} onClose={() => setIssued(null)} />
    </div>
  );
}
