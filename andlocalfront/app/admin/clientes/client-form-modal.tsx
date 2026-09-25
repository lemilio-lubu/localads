"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BadgeCheck, CalendarClock, CircleAlert, IdCard, KeyRound, Mail, UserCog, UserPen, UserPlus, UserRound, Wallet, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import ActionButton from "../../components/action-button";
import { ChoiceCheck, FormError, FormField as Field, FormHeader, FormSection as Section, formStyles as form } from "../../components/form-modal";
import ModalShell from "../../components/modal-shell";
import { createAdminClient, resetAdminClientPassword, updateAdminClient, type AdminClient, type AdminClientWithCredentials, type AdminPlatform, type SaveAdminClient } from "../../lib/admin-clients-api";
import { assignClientManager, getTeam, type TeamMember } from "../../lib/team-api";
import { normalizeRuc, rucKind, validateClientFields, type ClientProfileField } from "../../lib/form-validation";
import styles from "./client-form-modal.module.css";

type Props = {
  client: AdminClient | null;
  open: boolean;
  /* Solo el admin elige gestor. Un gestor se asigna a sí mismo y el backend lo
     toma del token, así que el selector le sobra y se le oculta. */
  isAdmin?: boolean;
  onClose: () => void;
  onSaved: (client: AdminClient) => void;
  onCreated?: (client: AdminClientWithCredentials) => void;
  onPasswordReset?: (client: AdminClientWithCredentials) => void;
};

const platformOptions: { value: AdminPlatform; label: string; logo: string; width: number; height: number }[] = [
  { value: "META", label: "Meta", logo: "/figma/meta.svg", width: 28, height: 19 },
  { value: "GOOGLE", label: "Google", logo: "/figma/google.svg", width: 22, height: 24 },
  { value: "TIKTOK", label: "TikTok", logo: "/figma/tiktok.svg", width: 20, height: 22 },
];

/* Cada tipo dice qué implica, no solo cómo se llama: quien crea el cliente
   decide cuándo paga, y eso es lo que cambia entre uno y otro. */
const accountOptions: { value: SaveAdminClient["accountType"]; label: string; detail: string; Icon: LucideIcon }[] = [
  { value: "PREPAGO", label: "Prepago", detail: "Paga antes de cada recarga", Icon: Wallet },
  { value: "POSTPAGO", label: "Postpago", detail: "Recarga ahora, paga a crédito", Icon: CalendarClock },
];

const creditPresets = [15, 30, 45, 60];

export default function ClientFormModal({ client, open, isAdmin = false, onClose, onSaved, onCreated, onPasswordReset }: Props) {
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [ruc, setRuc] = useState(client?.ruc ?? "");
  const [accountType, setAccountType] = useState<SaveAdminClient["accountType"]>(client?.account.type ?? "PREPAGO");
  const [platforms, setPlatforms] = useState<AdminPlatform[]>(client?.account.platforms ?? ["META"]);
  // Una cuenta postpago necesita al menos un dia de credito (BR-029), asi que
  // el valor inicial es valido y el campo no admite cero.
  const [creditDays, setCreditDays] = useState(client?.account.creditDays || 30);
  const [managerId, setManagerId] = useState(client?.manager?.id ?? "");
  const [managers, setManagers] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /* Un campo muestra su error cuando se sale de él o al intentar guardar;
     antes, marcar en rojo lo que todavía se está escribiendo solo estorba. */
  const [touched, setTouched] = useState<Partial<Record<ClientProfileField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [resetStep, setResetStep] = useState<"idle" | "confirm" | "pending">("idle");
  const [resetError, setResetError] = useState("");

  const fieldErrors = validateClientFields({ name, email, ruc, accountType, creditDays });
  const shown = (field: ClientProfileField) => (submitted || touched[field]) ? fieldErrors[field] : undefined;
  const touch = (field: ClientProfileField) => () => setTouched((current) => ({ ...current, [field]: true }));
  const kind = rucKind(ruc);
  const rucDigits = normalizeRuc(ruc).length;

  /* La lista de gestores se pide solo cuando el selector va a verse; si falla,
     el formulario sigue siendo usable sin asignar gestor. */
  useEffect(() => {
    if (!open || !isAdmin) return;
    let active = true;
    getTeam({ role: "GESTOR", status: "ACTIVE" }).then((team) => { if (active) setManagers(team); }).catch(() => undefined);
    return () => { active = false; };
  }, [isAdmin, open]);

  function togglePlatform(platform: AdminPlatform) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(fieldErrors).length) {
      // El foco va al primer campo con error: el lector de pantalla lo anuncia
      // y quien usa teclado no tiene que buscarlo. Se busca tras el render que
      // pinta los errores, por eso va en el siguiente frame.
      const form = event.currentTarget;
      requestAnimationFrame(() => (form.querySelector("[aria-invalid='true']") as HTMLElement | null)?.focus());
      return;
    }
    setPending(true); setError("");
    const input = { name, email, ruc: normalizeRuc(ruc), accountType, platforms, creditDays: accountType === "PREPAGO" ? 0 : creditDays };
    try {
      if (client) {
        const saved = await updateAdminClient(client.id, { ...input, expectedPlatformsVersion: client.platformsVersion });
        /* La reasignación es su propio endpoint, solo de admin: el PATCH del
           cliente no toca la cartera. Solo se llama si de verdad cambió. */
        const reassigned = isAdmin && managerId !== (client.manager?.id ?? "")
          ? { ...saved, manager: (await assignClientManager(client.id, managerId || null)).manager }
          : saved;
        onSaved(reassigned);
      } else {
        const created = await createAdminClient({ ...input, managerId: isAdmin ? managerId || null : undefined });
        onSaved(created);
        onCreated?.(created);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar el cliente");
    } finally { setPending(false); }
  }

  /* Restablecer no se deshace, así que pide un segundo clic aquí mismo en vez
     de abrir otro modal encima de este. El error se queda junto al botón. */
  async function resetPassword() {
    if (!client) return;
    setResetStep("pending"); setResetError("");
    try { onPasswordReset?.(await resetAdminClientPassword(client.id)); }
    catch (reason) { setResetError(reason instanceof Error ? reason.message : "No fue posible restablecer la contraseña"); setResetStep("confirm"); }
  }

  return (
    <ModalShell open={open} labelledBy="client-form-title" className={styles.modal} onClose={onClose}>
      <FormHeader titleId="client-form-title" Icon={client ? UserPen : UserPlus} eyebrow="cliente" title={client ? client.name : "Nuevo cliente"} subtitle={client ? "Editar datos, cuenta y plataformas" : undefined} />

      {/* noValidate: el globo nativo del navegador habla con su propia voz y no
          admite estilo. El mensaje lo escribe el producto, junto a cada campo. */}
      <form className={`${form.form} ${styles.layout}`} onSubmit={submit} noValidate>
        <Section title="Identidad" className={styles.identity}>
          <div className={form.grid}>
            <Field className={form.wide} label="Nombre o razón social" Icon={UserRound} error={shown("name")}>
              {({ id, describedBy, invalid }) => <input id={id} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} onBlur={touch("name")} maxLength={80} autoComplete="organization" placeholder="Ej. Comercial Andina S.A." aria-invalid={invalid} aria-describedby={describedBy} />}
            </Field>
            <Field label="RUC" Icon={IdCard} error={shown("ruc")} hint={kind
              ? <span className={form.valid}><BadgeCheck size={14} aria-hidden="true" />RUC válido · {kind}</span>
              : `${rucDigits}/13 dígitos`}>
              {({ id, describedBy, invalid }) => <input id={id} className={form.mono} value={ruc} onChange={(event) => { setRuc(event.target.value); setError(""); }} onBlur={touch("ruc")} inputMode="numeric" autoComplete="off" maxLength={17} placeholder="1790011674001" aria-invalid={invalid} aria-describedby={describedBy} />}
            </Field>
            <Field label="Correo" Icon={Mail} error={shown("email")}>
              {({ id, describedBy, invalid }) => <input id={id} type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} onBlur={touch("email")} autoComplete="email" placeholder="facturacion@empresa.ec" aria-invalid={invalid} aria-describedby={describedBy} />}
            </Field>
          </div>
        </Section>

        <Section title="Cuenta">
          <div className={form.choices} role="radiogroup" aria-label="Tipo de cuenta">
            {accountOptions.map(({ value, label, detail, Icon }) => (
              <label key={value} className={form.choice}>
                <input type="radio" name="accountType" value={value} checked={accountType === value} onChange={() => setAccountType(value)} />
                <Icon className={form.choiceIcon} size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className={form.choiceText}><strong>{label}</strong><small>{detail}</small></span>
                <ChoiceCheck />
              </label>
            ))}
          </div>

          <AnimatePresence initial={false}>
            {accountType === "POSTPAGO" && (
              <motion.div
                key="credit"
                className={styles.reveal}
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: reduceMotion ? 0 : .22, ease: [.23, 1, .32, 1] }}
              >
                <div className={styles.credit}>
                  <Field label="Días de crédito" Icon={CalendarClock} error={shown("creditDays")}>
                    {({ id, describedBy, invalid }) => <><input id={id} type="number" min={1} max={365} value={creditDays} onChange={(event) => { setCreditDays(Number(event.target.value)); setError(""); }} onBlur={touch("creditDays")} aria-invalid={invalid} aria-describedby={describedBy} /><span className={styles.suffix}>días</span></>}
                  </Field>
                  <div className={styles.presets} role="group" aria-label="Plazos frecuentes">
                    {creditPresets.map((days) => <button key={days} type="button" aria-pressed={creditDays === days} onClick={() => { setCreditDays(days); setError(""); }}>{days}</button>)}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isAdmin && (
            <Field label="Gestor responsable" Icon={UserCog}>
              {({ id, describedBy }) => (
                <select id={id} value={managerId} onChange={(event) => setManagerId(event.target.value)} aria-describedby={describedBy}>
                  <option value="">Sin asignar</option>
                  {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.username}</option>)}
                </select>
              )}
            </Field>
          )}
        </Section>

        <Section title="Plataformas" className={styles.wide}>
          <div className={styles.platforms}>
            {platformOptions.map(({ value, label, logo, width, height }) => (
              <label key={value} className={`${form.choice} ${styles.platform}`} data-platform={value.toLowerCase()}>
                <input type="checkbox" checked={platforms.includes(value)} onChange={() => togglePlatform(value)} />
                <span className={styles.platformLogo} aria-hidden="true"><Image src={logo} alt="" width={width} height={height} /></span>
                <strong>{label}</strong>
                <ChoiceCheck />
              </label>
            ))}
          </div>
          {/* Solo se habla cuando hay algo que advertir. */}
          {client
            ? <p className={form.sectionNote}>Al dar de baja una plataforma, sus recargas pendientes quedan en stop. Reactivarla conserva el saldo y requiere reanudar las recargas manualmente.</p>
            : !platforms.length && <p className={form.sectionNote}>Sin plataformas el cliente no podrá recargar hasta que habilites alguna.</p>}
        </Section>

        {client && (
          <Section title="Acceso al portal" className={styles.wide}>
            {resetStep === "idle"
              ? <div className={styles.accessRow}><p><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Genera una contraseña temporal nueva.</p><button type="button" className={form.secondary} onClick={() => setResetStep("confirm")}>Restablecer contraseña</button></div>
              : <div className={styles.resetConfirm}>
                  <p>La contraseña actual de <strong>{client.name}</strong> dejará de servir y se cerrarán sus sesiones. Los cambios sin guardar de este formulario se descartan.</p>
                  {resetError && <p className={form.fieldError} role="alert"><CircleAlert size={14} aria-hidden="true" />{resetError}</p>}
                  <div>
                    <button type="button" className={form.ghost} disabled={resetStep === "pending"} onClick={() => { setResetStep("idle"); setResetError(""); }}>Cancelar</button>
                    <button type="button" className={form.secondary} disabled={resetStep === "pending"} onClick={() => void resetPassword()}>{resetStep === "pending" ? "Restableciendo…" : "Sí, restablecer"}</button>
                  </div>
                </div>}
          </Section>
        )}

        <FormError message={error} />

        <footer className={form.footer}>
          {!client && <p><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Se generará una contraseña temporal que verás una sola vez.</p>}
          <div>
            <button type="button" className={form.ghost} onClick={onClose}>Cancelar</button>
            <ActionButton type="submit" disabled={pending}>{pending ? "Guardando…" : client ? "Guardar cambios" : "Crear cliente"}</ActionButton>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}
