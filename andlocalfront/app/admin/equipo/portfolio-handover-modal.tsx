"use client";

import { FormEvent, useState } from "react";
import ActionButton from "../../components/action-button";
import ModalShell from "../../components/modal-shell";
import type { TeamMember } from "../../lib/team-api";
import styles from "./portfolio-handover-modal.module.css";

type Props = {
  member: TeamMember | null;
  candidates: readonly TeamMember[];
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (handover: { reassignTo?: string; leaveUnassigned?: boolean }) => void;
};

/**
 * A donde va la cartera cuando su gestor se da de baja.
 *
 * Antes la baja soltaba los clientes sola: un gestor con veinte clientes
 * generaba veinte huerfanos de golpe, invisibles para todos los demas gestores
 * y sin ninguna senal para el admin. Soltarla sigue siendo una opcion valida
 * -a veces es lo que toca-, pero ahora hay que elegirla.
 *
 * Solo aparece cuando hay cartera en juego. Dar de baja a alguien sin clientes
 * no pregunta nada: no habria nada que decidir.
 */
export default function PortfolioHandoverModal({ member, candidates, pending, error, onClose, onConfirm }: Props) {
  const [choice, setChoice] = useState("");

  if (!member) return null;
  const clients = member.metrics.clients;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(choice === "release" ? { leaveUnassigned: true } : { reassignTo: choice });
  }

  return (
    <ModalShell open labelledBy="handover-title" className={styles.modal} onClose={onClose}>
      <h2 id="handover-title">dar de baja a {member.username}</h2>
      <p className={styles.lead}>
        Tiene <strong>{clients} {clients === 1 ? "cliente asignado" : "clientes asignados"}</strong>. Los clientes
        siguen activos: lo que cambia es quien responde por ellos.
      </p>

      <form onSubmit={submit} noValidate>
        <fieldset className={styles.options}>
          <legend>que pasa con su cartera</legend>
          {candidates.map((candidate) => (
            <label key={candidate.id}>
              <input type="radio" name="handover" value={candidate.id} checked={choice === candidate.id} onChange={() => setChoice(candidate.id)} />
              <span>pasarla a <strong>{candidate.username}</strong></span>
            </label>
          ))}
          {/* Soltarla es una eleccion mas, no el camino por defecto: va al
              final y dice a donde van a parar los clientes. */}
          <label>
            <input type="radio" name="handover" value="release" checked={choice === "release"} onChange={() => setChoice("release")} />
            <span>dejarla sin asignar <small>quedan en la bandeja del administrador</small></span>
          </label>
        </fieldset>

        {candidates.length === 0 && <p className={styles.empty}>No hay otros gestores activos a quien pasarla.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={pending}>cancelar</button>
          <ActionButton type="submit" disabled={!choice || pending}>
            {pending ? "dando de baja…" : "confirmar baja"}
          </ActionButton>
        </div>
      </form>
    </ModalShell>
  );
}
