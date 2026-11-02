"use client";

import { Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import Button from "../../components/atoms/button";
import FormError from "../../components/atoms/form-error";
import { TextInput } from "../../components/atoms/text-field";
import TextButton from "../../components/atoms/text-button";
import Checkbox from "../../components/molecules/checkbox";
import FormField from "../../components/molecules/form-field";
import form from "../../components/molecules/form-layout.module.css";
import { confirmMfaEnrollment, startMfaEnrollment, verifyMfa, type MfaResult, type MfaStep } from "../../lib/auth-api";
import styles from "./mfa-panel.module.css";

/* Las clases del encabezado y del botón las pone quien lo usa: en el login,
   las del panel de cristal; en «Cambiar contraseña», las de su tarjeta. */
type Look = { headingClassName: string; submitClassName?: string; titleAs?: "h1" | "h2" };

function Heading({ headingClassName, titleAs = "h1", title, children }: Look & { title: string; children: string }) {
  const Title = titleAs;
  return <header className={headingClassName}><Title id={titleAs === "h1" ? "login-title" : undefined}>{title}</Title><p>{children}</p></header>;
}

/* Segundo paso del login, con el doble factor activo: código de la app o de
   recuperación. */
export function MfaVerify({ step, onDone, onCancel, ...look }: Look & { step: MfaStep; onDone: (result: MfaResult) => void; onCancel: () => void }) {
  return <VerifyCode step={step} {...look} onDone={onDone} onCancel={onCancel} />;
}

/* Alta del doble factor, con la sesión ya abierta: QR + clave, código de
   confirmación y, justo después, los códigos de recuperación, que no vuelven
   a mostrarse. `skipLabel` pone la salida («Cancelar»). */
export function MfaEnrollment({ onFinished, onSkip, skipLabel, intro, ...look }: Look & { onFinished: () => void; onSkip: () => void; skipLabel: string; intro: string }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} {...look} onContinue={onFinished} />;
  return <Enroll {...look} intro={intro} onEnabled={setCodes} onSkip={onSkip} skipLabel={skipLabel} />;
}

/* Seis dígitos con un espacio en medio, como los muestran las apps. */
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);
const grouped = (digits: string) => digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;

function CodeInput({ id, describedBy, invalid, value, onChange, disabled }: { id: string; describedBy?: string; invalid: boolean; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <TextInput id={id} className={styles.code} value={grouped(value)} onChange={(event) => onChange(digitsOnly(event.target.value))} inputMode="numeric" autoComplete="one-time-code" placeholder="000 000" aria-invalid={invalid} aria-describedby={describedBy} autoFocus disabled={disabled} />;
}

function VerifyCode({ step, onDone, onCancel, ...look }: Look & { step: MfaStep; onDone: (result: MfaResult) => void; onCancel: () => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const complete = useRecovery ? code.replace(/[^a-z0-9]/gi, "").length === 10 : code.length === 6;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete) { setError(useRecovery ? "Escribe el código de recuperación completo." : "Escribe los 6 dígitos."); return; }
    setPending(true); setError("");
    try { onDone(await verifyMfa(step.challengeToken, code)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible verificar el código"); setPending(false); }
  }

  function toggle() { setUseRecovery((value) => !value); setCode(""); setError(""); }

  return <>
    <Heading {...look} title="Verificación en dos pasos">{useRecovery ? "Escribe uno de los códigos de recuperación que guardaste. Cada uno sirve una sola vez." : "Escribe el código de 6 dígitos de tu app de autenticación."}</Heading>
    <form className={form.form} onSubmit={submit} noValidate>
      <FormField label={useRecovery ? "Código de recuperación" : "Código"} Icon={useRecovery ? KeyRound : ShieldCheck}>
        {({ id, describedBy, invalid }) => useRecovery
          ? <TextInput id={id} className={styles.recoveryInput} value={code} onChange={(event) => { setCode(event.target.value.slice(0, 20)); setError(""); }} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" aria-invalid={invalid} aria-describedby={describedBy} autoFocus disabled={pending} />
          : <CodeInput id={id} describedBy={describedBy} invalid={invalid} value={code} onChange={(value) => { setCode(value); setError(""); }} disabled={pending} />}
      </FormField>
      <FormError message={error} />
      <Button variant="elevated" size="block" type="submit" className={look.submitClassName} disabled={pending}>{pending ? "Verificando…" : "Verificar"}</Button>
    </form>
    <p className={styles.links}>
      <TextButton size="inherit" underline="hover" onClick={toggle} disabled={pending}>{useRecovery ? "Usar el código de la app" : "Usar un código de recuperación"}</TextButton>
      {" · "}
      <TextButton size="inherit" underline="hover" onClick={onCancel} disabled={pending}>Volver</TextButton>
    </p>
  </>;
}

function Enroll({ intro, onEnabled, onSkip, skipLabel, ...look }: Look & { intro: string; onEnabled: (codes: string[]) => void; onSkip: () => void; skipLabel: string }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  /* El QR se dibuja en el navegador: el secreto no sale a ningún servicio. */
  useEffect(() => {
    let active = true;
    startMfaEnrollment()
      .then(async ({ secret, otpauthUri }) => {
        const qr = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 176, errorCorrectionLevel: "M" });
        if (active) setSetup({ secret, qr });
      })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : "No fue posible preparar el doble factor"); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) { setError("Escribe los 6 dígitos que muestra la app."); return; }
    setPending(true); setError("");
    try { onEnabled((await confirmMfaEnrollment(code)).recoveryCodes); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible activar el doble factor"); setPending(false); }
  }

  return <>
    <Heading {...look} title="Protege tu cuenta">{intro}</Heading>
    {loadError
      ? <FormError message={loadError} />
      : <div className={styles.setup} aria-busy={!setup}>
          {setup ? <Image className={styles.qr} src={setup.qr} width={112} height={112} unoptimized alt="Código QR para tu app de autenticación" /> : <div className={styles.qr} aria-hidden="true" />}
          <div className={styles.manual}>
            <span>¿No puedes escanearlo? Escribe esta clave en la app:</span>
            {/* Entera y partida en grupos de cuatro: hay que poder teclearla. */}
            {setup && <code className={styles.secret}>{setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret}</code>}
            {setup && <CopySecret secret={setup.secret} />}
          </div>
        </div>}
    <form className={form.form} onSubmit={submit} noValidate>
      <FormField label="Código que muestra la app" Icon={ShieldCheck}>
        {({ id, describedBy, invalid }) => <CodeInput id={id} describedBy={describedBy} invalid={invalid} value={code} onChange={(value) => { setCode(value); setError(""); }} disabled={pending || !setup} />}
      </FormField>
      <FormError message={error} />
      <Button variant="elevated" size="block" type="submit" className={look.submitClassName} disabled={pending || !setup}>{pending ? "Activando…" : "Activar"}</Button>
    </form>
    <p className={styles.links}><TextButton size="inherit" underline="hover" onClick={onSkip} disabled={pending}>{skipLabel}</TextButton></p>
  </>;
}

function CopySecret({ secret }: { secret: string }) {
  const [state, setState] = useState<"done" | "failed" | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(secret); setState("done"); }
    catch { setState("failed"); }
  }
  return <TextButton size="inherit" underline="hover" className={styles.copySecret} onClick={() => void copy()}><Copy size={14} aria-hidden="true" />{state === "done" ? "copiada" : state === "failed" ? "no se pudo copiar" : "copiar clave"}</TextButton>;
}

function RecoveryCodes({ codes, onContinue, ...look }: Look & { codes: string[]; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);

  async function copy() {
    try { await navigator.clipboard.writeText(codes.join("\n")); setCopied("done"); }
    catch { setCopied("failed"); }
  }

  function download() {
    const text = `Códigos de recuperación de AND Local Ads\nCada código sirve una sola vez.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "andlocalads-codigos-de-recuperacion.txt"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return <>
    <Heading {...look} title="Guarda tus códigos de recuperación">Si pierdes el móvil, cada código te deja entrar una vez. No volverán a mostrarse.</Heading>
    <ul className={styles.codes} aria-label="Códigos de recuperación">
      {codes.map((code) => <li key={code}>{code}</li>)}
    </ul>
    <div className={styles.codeActions}>
      <Button variant="secondary" onClick={() => void copy()}><Copy size={16} aria-hidden="true" />{copied === "done" ? "copiados" : copied === "failed" ? "no se pudo copiar" : "copiar"}</Button>
      <Button variant="secondary" onClick={download}><Download size={16} aria-hidden="true" />descargar</Button>
    </div>
    <Checkbox checked={saved} onChange={(value) => { setSaved(value); setError(""); }}>Los guardé en un lugar seguro</Checkbox>
    <FormError message={error} />
    <Button variant="elevated" size="block" className={look.submitClassName} onClick={() => saved ? onContinue() : setError("Confirma que guardaste los códigos antes de continuar.")}>Continuar</Button>
  </>;
}
