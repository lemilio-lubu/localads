"use client";

import { AtSign, Briefcase, KeyRound, ShieldCheck, UserPlus, type LucideIcon } from "lucide-react";
import { FormEvent, useState } from "react";
import ActionButton from "../../components/action-button";
import { ChoiceCheck, FormError, FormField, FormHeader, FormSection, formStyles as form } from "../../components/form-modal";
import ModalShell from "../../components/modal-shell";
import { createTeamMember, type TeamMemberWithCredentials, type TeamRole } from "../../lib/team-api";
import { validateTeamUsername } from "../../lib/form-validation";
import styles from "./team-form-modal.module.css";

type Props = { open: boolean; onClose: () => void; onCreated: (member: TeamMemberWithCredentials) => void };

/* Cada rol dice qué verá, no solo cómo se llama: es lo que decide quien crea
   la cuenta. */
const roleOptions: { value: TeamRole; label: string; detail: string; Icon: LucideIcon }[] = [
  { value: "GESTOR", label: "Gestor", detail: "Ve solo los clientes asignados", Icon: Briefcase },
  { value: "ADMIN", label: "Administrador", detail: "Ve todo y administra el equipo", Icon: ShieldCheck },
];

export default function TeamFormModal({ open, onClose, onCreated }: Props) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("GESTOR");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /* Igual que en el formulario de cliente: el error del campo aparece al salir
     de él o al intentar crear, no mientras se escribe. */
  const [touched, setTouched] = useState(false);
  const usernameError = validateTeamUsername(username);
  const shownUsernameError = touched ? usernameError : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (usernameError) {
      const formElement = event.currentTarget;
      requestAnimationFrame(() => (formElement.querySelector("[aria-invalid='true']") as HTMLElement | null)?.focus());
      return;
    }
    setPending(true); setError("");
    try {
      const member = await createTeamMember({ username, role });
      setUsername(""); setRole("GESTOR"); setTouched(false);
      onCreated(member);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible crear la cuenta");
    } finally { setPending(false); }
  }

  return (
    <ModalShell open={open} labelledBy="team-form-title" className={styles.modal} onClose={onClose}>
      <FormHeader titleId="team-form-title" Icon={UserPlus} title="Nueva cuenta de equipo" />
      {/* noValidate: el navegador mostraba su propio globo negro, con su voz y
          sin poder darle estilo. El mensaje lo escribe el producto. */}
      <form className={form.form} onSubmit={submit} noValidate>
        <FormSection title="Acceso">
          {/* Se escribe libre y se guarda en minúscula: rechazar «Gestor» por
              llevar mayúscula sería hostil sin motivo. */}
          <FormField label="Usuario" Icon={AtSign} error={shownUsernameError} hint="Con este nombre entrará al portal. Se guarda en minúscula.">
            {({ id, describedBy, invalid }) => <input id={id} value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} onBlur={() => setTouched(true)} maxLength={24} autoComplete="off" placeholder="gestor.norte" aria-invalid={invalid} aria-describedby={describedBy} />}
          </FormField>
        </FormSection>

        <FormSection title="Rol">
          <div className={form.choices} role="radiogroup" aria-label="Rol">
            {roleOptions.map(({ value, label, detail, Icon }) => (
              <label key={value} className={form.choice}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
                <Icon className={form.choiceIcon} size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className={form.choiceText}><strong>{label}</strong><small>{detail}</small></span>
                <ChoiceCheck />
              </label>
            ))}
          </div>
        </FormSection>

        <FormError message={error} />

        <footer className={form.footer}>
          <p><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Se generará una contraseña temporal que verás una sola vez.</p>
          <div>
            <button type="button" className={form.ghost} onClick={onClose}>Cancelar</button>
            <ActionButton type="submit" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</ActionButton>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}
