"use client";

import { ArrowLeft, KeyRound, Link2, Power, RotateCw, Save, Unlink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CredentialsModal from "../../../components/credentials-modal";
import { formatAmount, formatDateTime } from "../../../lib/format";
import { getAdminClients, type AdminClient } from "../../../lib/admin-clients-api";
import { assignClientManager, getTeamMember, resetTeamMemberPassword, updateTeamMember, type IssuedCredentials, type TeamMemberDetail, type TeamRole } from "../../../lib/team-api";
import styles from "./team-member-detail.module.css";

const roleLabel = (role: TeamRole) => role === "ADMIN" ? "administrador" : "gestor";

export default function TeamMemberDetailView({ id }: { id: string }) {
  const [member, setMember] = useState<TeamMemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("GESTOR");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<{ credentials: IssuedCredentials; title: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const [unassigned, setUnassigned] = useState<AdminClient[]>([]);

  useEffect(() => {
    let active = true;
    getTeamMember(id)
      .then((data) => { if (!active) return; setError(""); setMember(data); setUsername(data.username); setRole(data.role); setNote(data.note ?? ""); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar la cuenta"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reloadToken]);

  /* La bandeja de clientes sin gestor se pide solo cuando se abre el selector:
     no es lo que viene a ver quien entra al detalle. */
  useEffect(() => {
    if (!linking) return;
    let active = true;
    getAdminClients().then((clients) => { if (active) setUnassigned(clients.filter((client) => !client.manager && client.status === "ACTIVE")); }).catch(() => undefined);
    return () => { active = false; };
  }, [linking, reloadToken]);

  const dirty = useMemo(() => Boolean(member) && (username !== member?.username || role !== member?.role || note !== (member?.note ?? "")), [member, note, role, username]);

  function reload() { setReloadToken((token) => token + 1); }

  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(label); setActionError(""); setNotice("");
    try { await operation(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "No fue posible completar la operación"); }
    finally { setBusy(""); }
  }

  if (loading) return <div className={styles.module}><div className={styles.skeleton} aria-hidden="true" /></div>;

  if (error || !member) return <div className={styles.module}>
    <Link className={styles.back} href="/admin/equipo"><ArrowLeft size={16} aria-hidden="true" />volver al equipo</Link>
    <div className={styles.errorPanel} role="alert">
      <p><strong>No se pudo cargar la cuenta</strong></p>
      <p>{error}</p>
      <button type="button" onClick={() => { setLoading(true); setError(""); reload(); }}><RotateCw size={16} aria-hidden="true" />reintentar</button>
    </div>
  </div>;

  return (
    <div className={styles.module}>
      <Link className={styles.back} href="/admin/equipo"><ArrowLeft size={16} aria-hidden="true" />volver al equipo</Link>

      <header className={styles.header}>
        <div><small>usuario</small><h2>{member.username}</h2><span data-role={member.role}>{roleLabel(member.role)}</span></div>
        <dl className={styles.metrics}>
          <div><dt>cuentas</dt><dd>{member.metrics.clients}</dd></div>
          <div><dt>ventas</dt><dd>{member.metrics.sales}</dd></div>
          <div><dt>estado</dt><dd className={styles.status}>{member.status === "ACTIVE" ? "activo" : "inactivo"}</dd></div>
        </dl>
      </header>

      <section className={`${styles.panel} ${styles.primaryPanel}`}>
        <h3>datos de la cuenta</h3>
        <div className={styles.fields}>
          <label><span>usuario</span><input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={24} /></label>
          <label><span>rol</span>
            <select value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
              <option value="GESTOR">gestor</option>
              <option value="ADMIN">administrador</option>
            </select>
          </label>
          <label className={styles.noteField}><span>nota</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} /></label>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className={styles.primary} disabled={!dirty || Boolean(busy)} onClick={() => void run("save", async () => {
            await updateTeamMember(member.id, { username, role, note: note.trim() || null });
            setNotice("Cambios guardados."); reload();
          })}><Save size={16} aria-hidden="true" />{busy === "save" ? "guardando…" : "guardar cambios"}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void run("reset", async () => {
            const updated = await resetTeamMemberPassword(member.id);
            setIssued({ credentials: updated.credentials, title: `nueva contraseña de ${updated.username}` }); reload();
          })}><KeyRound size={16} aria-hidden="true" />restablecer contraseña</button>
          <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void run("toggle", async () => {
            const updated = await updateTeamMember(member.id, { status: member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
            /* Dar de baja a un gestor no da de baja a sus clientes: quedan sin
               asignar y el admin los reparte. Decirlo evita la duda. */
            setNotice(updated.releasedClients ? `Cuenta desactivada. ${updated.releasedClients} ${updated.releasedClients === 1 ? "cliente quedó" : "clientes quedaron"} sin gestor.` : "Cuenta actualizada.");
            reload();
          })}><Power size={16} aria-hidden="true" />{member.status === "ACTIVE" ? "dar de baja" : "reactivar"}</button>
        </div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {actionError && <p className={styles.rowNotice} role="alert">{actionError}</p>}
      </section>

      <aside className={styles.sideColumn}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>cuentas <b>{member.clients.length}</b></h3>
            {member.role === "GESTOR" && member.status === "ACTIVE" && <button type="button" className={styles.link} onClick={() => setLinking((open) => !open)}><Link2 size={16} aria-hidden="true" />vincular cuenta</button>}
          </div>

          {linking && <div className={styles.picker}>
            {unassigned.length === 0
              ? <p>No hay clientes sin gestor ahora mismo.</p>
              : unassigned.map((client) => <button key={client.id} type="button" disabled={Boolean(busy)} onClick={() => void run("assign", async () => {
                  await assignClientManager(client.id, member.id);
                  setLinking(false); setNotice(`${client.name} quedó asignado.`); reload();
                })}>{client.name}</button>)}
          </div>}

          {member.clients.length === 0
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

        <section className={styles.panel}>
          <h3>ventas <b>{member.sales.length}</b></h3>
          {/* Sin acción de vincular: una venta pertenece al cliente y sigue a su
              cartera. Asignarla a mano rompería esa relación. */}
          {member.sales.length === 0
            ? <p className={styles.empty}>Todavía no hay recargas completadas en esta cartera.</p>
            : <ul className={styles.sales}>
                {member.sales.map((sale) => <li key={sale.id}>
                  <Link href="/admin/transacciones"><strong>{sale.clientName}</strong><span>{formatAmount(sale.totalAmount)}</span><small>{formatDateTime(sale.createdAt)}</small></Link>
                </li>)}
              </ul>}
        </section>
      </aside>

      <CredentialsModal credentials={issued?.credentials ?? null} title={issued?.title ?? ""} onClose={() => setIssued(null)} />
    </div>
  );
}
