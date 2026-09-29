"use client";

import { AtSign, KeyRound, Link2, Power, RotateCw, Save, Unlink, UserCog } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MetricCard from "../../components/metric-card";
import ModalShell from "../../components/modal-shell";
import { FormError, FormField, formStyles as form } from "../../components/form-modal";
import { formatAmount, formatDateTime } from "../../lib/format";
import { getAdminClients, type AdminClient } from "../../lib/admin-clients-api";
import { assignClientManager, getTeamMember, updateTeamMember, type TeamMember, type TeamMemberDetail, type TeamRole } from "../../lib/team-api";
import { validateTeamUsername } from "../../lib/form-validation";
import styles from "./team-member-modal.module.css";

type Props = {
  memberId: string | null;
  onClose: () => void;
  /* Algo cambió (datos, cartera): la lista recarga sus recuentos. */
  onChanged: () => void;
  /* Restablecer y dar de baja no se resuelven aquí: la lista ya tiene esos
     flujos -la ventana de credenciales y el destino de cartera- y el modal
     se cierra para dejarles sitio en vez de apilar un modal sobre otro. */
  onResetPassword: (member: TeamMember) => void;
  onToggleStatus: (member: TeamMember) => void;
};

/* Ficha de un miembro del equipo, con la misma composición que el detalle de
   cliente: identidad y métricas arriba, y debajo una rejilla de paneles
   -datos de la cuenta a toda altura a la izquierda, cartera y ventas a la
   derecha-. */
export default function TeamMemberModal({ memberId, onClose, onChanged, onResetPassword, onToggleStatus }: Props) {
  const [member, setMember] = useState<TeamMemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("GESTOR");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [linking, setLinking] = useState(false);
  const [unassigned, setUnassigned] = useState<AdminClient[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    let active = true;
    getTeamMember(memberId)
      .then((data) => { if (!active) return; setError(""); setMember(data); setUsername(data.username); setRole(data.role); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar la cuenta"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId, reloadToken]);

  /* La bandeja de clientes sin gestor se pide solo cuando se abre el selector:
     no es lo que viene a ver quien abre la ficha. */
  useEffect(() => {
    if (!linking) return;
    let active = true;
    getAdminClients().then((clients) => { if (active) setUnassigned(clients.filter((client) => !client.manager && client.status === "ACTIVE")); }).catch(() => undefined);
    return () => { active = false; };
  }, [linking, reloadToken]);

  const dirty = useMemo(() => Boolean(member) && (username.trim().toLowerCase() !== member?.username || role !== member?.role), [member, role, username]);
  const usernameError = dirty ? validateTeamUsername(username) : "";

  function reload() { setReloadToken((token) => token + 1); onChanged(); }

  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(label); setActionError(""); setNotice("");
    try { await operation(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "No fue posible completar la operación"); }
    finally { setBusy(""); }
  }

  const isManager = member?.role === "GESTOR";

  return (
    <ModalShell open={Boolean(memberId)} labelledBy="team-member-title" className={styles.modal} onClose={onClose}>
      {loading && <div className={styles.skeleton} aria-hidden="true" />}

      {!loading && (error || !member) && <div className={styles.errorPanel} role="alert">
        <h2 id="team-member-title">No se pudo cargar la cuenta</h2>
        <p>{error}</p>
        <button type="button" onClick={() => { setLoading(true); setError(""); setReloadToken((token) => token + 1); }}><RotateCw size={16} aria-hidden="true" />reintentar</button>
      </div>}

      {!loading && member && <>
        <header className={styles.summary}>
          <div className={styles.identity}>
            <span className={styles.accountBadge}>cuenta <b>{isManager ? "gestor" : "administrador"}</b></span>
            <h2 id="team-member-title">{member.username}</h2>
          </div>
          <div className={styles.metrics}>
            <MetricCard className={isManager ? styles.metric : styles.metricText} label="cuentas" valueSize={isManager ? "regular" : "small"}>{isManager ? String(member.metrics.clients) : "no aplica"}</MetricCard>
            <MetricCard className={isManager ? styles.metric : styles.metricText} label="ventas" tone="success" valueSize={isManager ? "regular" : "small"}>{isManager ? String(member.metrics.sales) : "no aplica"}</MetricCard>
            <MetricCard className={styles.metric} label="estado">{member.status === "ACTIVE" ? "activo" : "inactivo"}</MetricCard>
            {/* Texto y no cifra: en tamaño pequeño, como «no aplica» en las listas. */}
            <MetricCard className={styles.metricText} label="acceso" valueSize="small">{member.mustChangePassword ? "clave temporal" : "clave propia"}</MetricCard>
          </div>
        </header>

        <div className={styles.detailGrid}>
          <section className={`${styles.panel} ${styles.accountPanel}`} aria-labelledby="team-member-data">
            <h3 id="team-member-data">Datos de la cuenta</h3>
            <div className={styles.fields}>
              <FormField label="Usuario" Icon={AtSign} error={usernameError}>
                {({ id, describedBy, invalid }) => <input id={id} value={username} onChange={(event) => { setUsername(event.target.value); setNotice(""); }} maxLength={24} autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy} />}
              </FormField>
              <FormField label="Rol" Icon={UserCog}>
                {({ id, describedBy }) => <select id={id} value={role} onChange={(event) => { setRole(event.target.value as TeamRole); setNotice(""); }} aria-describedby={describedBy}>
                  <option value="GESTOR">Gestor</option>
                  <option value="ADMIN">Administrador</option>
                </select>}
              </FormField>
            </div>
            <button type="button" className={styles.primary} disabled={!dirty || Boolean(usernameError) || Boolean(busy)} onClick={() => void run("save", async () => {
              await updateTeamMember(member.id, { username, role });
              setNotice("Cambios guardados."); reload();
            })}><Save size={16} aria-hidden="true" />{busy === "save" ? "guardando…" : "guardar cambios"}</button>

            {notice && <p className={styles.notice} role="status">{notice}</p>}
            <FormError message={actionError} />

            <div className={styles.access}>
              {confirmReset
                ? <div className={styles.confirm}>
                    <p>La contraseña actual de <strong>{member.username}</strong> dejará de servir y se cerrarán sus sesiones.</p>
                    <div>
                      <button type="button" className={form.ghost} onClick={() => setConfirmReset(false)}>Cancelar</button>
                      <button type="button" className={form.secondary} onClick={() => onResetPassword(member)}>Sí, restablecer</button>
                    </div>
                  </div>
                : <>
                    <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmReset(true)}><KeyRound size={16} aria-hidden="true" />restablecer contraseña</button>
                    {/* Dar de baja a un gestor con cartera exige decir a dónde
                        va: lo pregunta el modal de destino de la lista. */}
                    <button type="button" className={member.status === "ACTIVE" ? styles.danger : undefined} disabled={Boolean(busy)} onClick={() => onToggleStatus(member)}><Power size={16} aria-hidden="true" />{member.status === "ACTIVE" ? "dar de baja" : "reactivar"}</button>
                  </>}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="team-member-clients">
            <div className={styles.panelHead}>
              <h3 id="team-member-clients">Cartera</h3>
              {isManager && member.status === "ACTIVE" && <button type="button" className={styles.link} onClick={() => setLinking((open) => !open)} aria-expanded={linking}><Link2 size={16} aria-hidden="true" />vincular cliente</button>}
            </div>
            {linking && <div className={styles.picker}>
              {unassigned.length === 0
                ? <p>No hay clientes sin gestor ahora mismo.</p>
                : unassigned.map((client) => <button key={client.id} type="button" disabled={Boolean(busy)} onClick={() => void run("assign", async () => {
                    await assignClientManager(client.id, member.id);
                    setLinking(false); setNotice(`${client.name} quedó asignado.`); reload();
                  })}>{client.name}</button>)}
            </div>}
            {!isManager
              ? <p className={styles.empty}>Un administrador no lleva cartera propia.</p>
              : member.clients.length === 0
                ? <p className={styles.empty}>Sin clientes asignados.</p>
                : <ul className={styles.chips}>
                    {member.clients.map((client) => <li key={client.id} data-inactive={client.status === "INACTIVE"}>
                      <Link href="/admin/clientes">{client.name}</Link>
                      <button type="button" aria-label={`Desvincular a ${client.name}`} disabled={Boolean(busy)} onClick={() => void run("unassign", async () => {
                        await assignClientManager(client.id, null);
                        setNotice(`${client.name} quedó sin gestor.`); reload();
                      })}><Unlink size={13} aria-hidden="true" /></button>
                    </li>)}
                  </ul>}
          </section>

          <section className={styles.panel} aria-labelledby="team-member-sales">
            <h3 id="team-member-sales">Ventas</h3>
            {/* Sin acción de vincular: una venta pertenece al cliente y sigue a
                su cartera. Asignarla a mano rompería esa relación. */}
            {!isManager
              ? <p className={styles.empty}>Las ventas se cuentan por cartera de gestor.</p>
              : member.sales.length === 0
                ? <p className={styles.empty}>Todavía no hay recargas completadas en esta cartera.</p>
                : <div className={styles.sales}>
                    {member.sales.map((sale) => <Link key={sale.id} href="/admin/transacciones" className={styles.sale}>
                      <span title={sale.code}>{sale.clientName}</span>
                      <time dateTime={sale.createdAt}>{formatDateTime(sale.createdAt)}</time>
                      <strong>+{formatAmount(sale.totalAmount)}</strong>
                    </Link>)}
                  </div>}
          </section>
        </div>
      </>}
    </ModalShell>
  );
}
