"use client";

import { AtSign, Briefcase, UserRound, KeyRound, ShieldCheck, UserPlus, type LucideIcon } from "lucide-react";
import { FormEvent, useState } from "react";
import FormError from "../../components/molecules/form-error";
import ChoiceCard, { ChoiceGroup } from "../../components/molecules/choice-card";
import FormField from "../../components/molecules/form-field";
import FormHeader from "../../components/molecules/form-header";
import FormSection from "../../components/molecules/form-section";
import form from "../../components/molecules/form-layout.module.css";
import ModalShell from "../../components/organisms/modal-shell";
import { createTeamMember, type TeamMemberWithCredentials, type TeamRole } from "../../lib/team-api";
import { validateTeamEmail, validateTeamName } from "../../lib/form-validation";
import styles from "./team-form-modal.module.css";
import { TextInput } from "../../components/atoms/text-field";
import Button from "../../components/atoms/button";

type Props = { open: boolean; onClose: () => void; onCreated: (member: TeamMemberWithCredentials) => void };

/* Cada rol dice qué verá, no solo cómo se llama: es lo que decide quien crea
   la cuenta. */
const roleOptions: { value: TeamRole; label: string; detail: string; Icon: LucideIcon }[] = [
  { value: "GESTOR", label: "Gestor", detail: "Ve solo los clientes asignados", Icon: Briefcase },
  { value: "ADMIN", label: "Administrador", detail: "Ve todo y administra el equipo", Icon: ShieldCheck },
];

export default function TeamFormModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<TeamRole>("GESTOR");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /* Igual que en el formulario de cliente: el error del campo aparece al salir
     de él o al intentar crear, no mientras se escribe. */
  const [touched, setTouched] = useState({ name: false, username: false });
  const nameError = validateTeamName(name);
  const shownNameError = touched.name ? nameError : "";
  const usernameError = validateTeamEmail(username);
  const shownUsernameError = touched.username ? usernameError : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ name: true, username: true });
    if (nameError || usernameError) {
      const formElement = event.currentTarget;
      requestAnimationFrame(() => (formElement.querySelector("[aria-invalid='true']") as HTMLElement | null)?.focus());
      return;
    }
    setPending(true); setError("");
    try {
      const member = await createTeamMember({ username, name: name.trim(), role });
      setName(""); setUsername(""); setRole("GESTOR"); setTouched({ name: false, username: false });
      onCreated(member);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible crear la cuenta");
    } finally { setPending(false); }
  }

  return (
    <ModalShell open={open} labelledBy="team-form-title" className={styles.modal} onClose={onClose}>
      <FormHeader titleId="team-form-title" Icon={UserPlus} eyebrow="equipo" title="Nueva cuenta" />
      {/* noValidate: el navegador mostraba su propio globo negro, con su voz y
          sin poder darle estilo. El mensaje lo escribe el producto. */}
      <form className={`${form.form} ${styles.layout}`} onSubmit={submit} noValidate>
        <FormSection title="Acceso">
          <FormField label="Nombre" Icon={UserRound} error={shownNameError}>
            {({ id, describedBy, invalid }) => <TextInput id={id} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} onBlur={() => setTouched((state) => ({ ...state, name: true }))} maxLength={80} autoComplete="off" placeholder="Marta Pérez" aria-invalid={invalid} aria-describedby={describedBy} />}
          </FormField>
          {/* Se escribe libre y se guarda en minúscula: rechazar «Gestor» por
              llevar mayúscula sería hostil sin motivo. */}
          <FormField label="Correo" Icon={AtSign} error={shownUsernameError}>
            {({ id, describedBy, invalid }) => <TextInput id={id} value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} onBlur={() => setTouched((state) => ({ ...state, username: true }))} maxLength={120} autoComplete="off" inputMode="email" autoCapitalize="none" placeholder="gestor@empresa.ec" aria-invalid={invalid} aria-describedby={describedBy} />}
          </FormField>
        </FormSection>

        <FormSection title="Rol">
          <ChoiceGroup label="Rol">
            {roleOptions.map(({ value, label, detail, Icon }) => (
              <ChoiceCard key={value} name="role" value={value} checked={role === value} onChange={() => setRole(value)} Icon={Icon} title={label} detail={detail} />
            ))}
          </ChoiceGroup>
        </FormSection>

        <FormError message={error} />

        <footer className={form.footer}>
          <p><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Se generará una contraseña temporal que verás una sola vez.</p>
          <div>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="elevated" size="cta" type="submit" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</Button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}
