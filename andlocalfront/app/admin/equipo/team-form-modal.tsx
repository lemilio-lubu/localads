"use client";

import { CirclePlus } from "lucide-react";
import { FormEvent, useState } from "react";
import ActionButton from "../../components/action-button";
import ModalShell from "../../components/modal-shell";
import { createTeamMember, type TeamMemberWithCredentials, type TeamRole } from "../../lib/team-api";
import { validateTeamUsername } from "../../lib/form-validation";
import styles from "./team-form-modal.module.css";

type Props = { open: boolean; onClose: () => void; onCreated: (member: TeamMemberWithCredentials) => void };

export default function TeamFormModal({ open, onClose, onCreated }: Props) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("GESTOR");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateTeamUsername(username);
    if (invalid) { setError(invalid); return; }
    setPending(true); setError("");
    try {
      const member = await createTeamMember({ username, role, note: note.trim() || undefined });
      setUsername(""); setRole("GESTOR"); setNote("");
      onCreated(member);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible crear la cuenta");
    } finally { setPending(false); }
  }

  return (
    <ModalShell open={open} labelledBy="team-form-title" className={styles.modal} onClose={onClose}>
      <h2 id="team-form-title">crear cuenta</h2>
      {/* noValidate: el navegador mostraba su propio globo negro, con su voz y
          sin poder darle estilo. El mensaje lo escribe el producto. */}
      <form onSubmit={submit} noValidate>
        {/* Se escribe libre y se guarda en minúscula: rechazar «Gestor» por
            llevar mayúscula sería hostil sin motivo. */}
        <label><span>usuario</span><input value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} aria-invalid={Boolean(error)} maxLength={24} autoFocus placeholder="gestor.norte" /></label>
        <label><span>rol</span>
          <select value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
            <option value="GESTOR">gestor</option>
            <option value="ADMIN">administrador</option>
          </select>
        </label>
        <p className={styles.hint}>{role === "GESTOR" ? "Verá solo los clientes que tenga asignados." : "Verá todos los clientes y podrá administrar el equipo."}</p>
        <label className={styles.wide}><span>nota</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} placeholder="Para qué es esta cuenta, de quién es" /></label>
        <p className={styles.error} role="alert">{error}</p>
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>cancelar</button>
          <ActionButton type="submit" className={styles.submit} disabled={pending}><CirclePlus size={16} aria-hidden="true" />{pending ? "creando…" : "crear cuenta"}</ActionButton>
        </div>
      </form>
    </ModalShell>
  );
}
