"use client";

import { LockKeyhole, ShieldCheck, ShieldOff } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import Button from "../../components/atoms/button";
import FormError from "../../components/molecules/form-error";
import { TextInput } from "../../components/atoms/text-field";
import FormField from "../../components/molecules/form-field";
import form from "../../components/molecules/form-layout.module.css";
import { disableMfa, getMfaStatus } from "../../lib/auth-api";
import { MfaEnrollment } from "./mfa-panel";
import styles from "./mfa-settings.module.css";

type Status = { enabled: boolean; recoveryCodesLeft: number };

/* Bloque «Doble factor» de la pantalla de la cuenta. Es opcional: aquí se
   activa (QR, código y códigos de recuperación) o se quita (con la clave y un
   código, para que una sesión desatendida no baste). */
export default function MfaSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"idle" | "enroll" | "disable">("idle");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    getMfaStatus().then((value) => { if (active) setStatus(value); })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : "No fue posible consultar el doble factor"); });
    return () => { active = false; };
  }, []);

  if (loadError) return <section className={styles.section} aria-labelledby="mfa-title"><h2 id="mfa-title">Doble factor</h2><FormError message={loadError} /></section>;
  if (!status) return <section className={styles.section} aria-busy="true" aria-labelledby="mfa-title"><h2 id="mfa-title">Doble factor</h2></section>;

  if (mode === "enroll") return <section className={styles.section}>
    <MfaEnrollment headingClassName={styles.heading} titleAs="h2" intro="Escanea el código con Google Authenticator, Microsoft Authenticator o 1Password. Desde entonces, al entrar te pediremos un código además de la contraseña." skipLabel="Cancelar" onSkip={() => setMode("idle")} onFinished={() => { setStatus({ enabled: true, recoveryCodesLeft: 10 }); setMode("idle"); setNotice("Doble factor activado."); }} />
  </section>;

  return <section className={styles.section} aria-labelledby="mfa-title">
    <header className={styles.heading}>
      <h2 id="mfa-title">Doble factor</h2>
      <p>{status.enabled
        ? `Activo. Al entrar te pedimos un código de tu app. Te ${status.recoveryCodesLeft === 1 ? "queda 1 código" : `quedan ${status.recoveryCodesLeft} códigos`} de recuperación.`
        : "Opcional. Con él, tu contraseña sola no basta para entrar en tu cuenta."}</p>
    </header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {mode === "disable"
      ? <DisableForm onCancel={() => setMode("idle")} onDisabled={() => { setStatus({ enabled: false, recoveryCodesLeft: 0 }); setMode("idle"); setNotice("Doble factor desactivado."); }} />
      : status.enabled
        ? <Button variant="secondary" onClick={() => { setNotice(""); setMode("disable"); }}><ShieldOff size={16} aria-hidden="true" />quitar doble factor</Button>
        : <Button variant="secondary" onClick={() => { setNotice(""); setMode("enroll"); }}><ShieldCheck size={16} aria-hidden="true" />activar doble factor</Button>}
  </section>;
}

function DisableForm({ onCancel, onDisabled }: { onCancel: () => void; onDisabled: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || !code.trim()) { setError("Escribe tu contraseña y un código de tu app (o uno de recuperación)."); return; }
    setPending(true); setError("");
    try { await disableMfa(password, code.trim()); onDisabled(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible quitar el doble factor"); setPending(false); }
  }

  return <form className={form.form} onSubmit={submit} noValidate>
    <FormField label="Contraseña" Icon={LockKeyhole}>
      {({ id, describedBy, invalid }) => <TextInput id={id} type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} aria-invalid={invalid} aria-describedby={describedBy} autoFocus disabled={pending} />}
    </FormField>
    <FormField label="Código de tu app o de recuperación" Icon={ShieldCheck}>
      {({ id, describedBy, invalid }) => <TextInput id={id} value={code} onChange={(event) => { setCode(event.target.value.slice(0, 20)); setError(""); }} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} aria-invalid={invalid} aria-describedby={describedBy} disabled={pending} />}
    </FormField>
    <FormError message={error} />
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
      <Button variant="danger-soft" type="submit" disabled={pending}>{pending ? "quitando…" : "quitar doble factor"}</Button>
    </div>
  </form>;
}
