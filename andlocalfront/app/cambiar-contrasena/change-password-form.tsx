"use client";

import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { FormEvent, useEffect, useState } from "react";
import ActionButton from "../components/action-button";
import BrandLogo from "../components/brand-logo";
import { enterTransition } from "../design-system/motion";
import { changePassword, getCurrentUser, refreshSession } from "../lib/auth-api";
import styles from "./change-password-form.module.css";

const minimum = 8;

export default function ChangePasswordForm() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [username, setUsername] = useState("");
  /* La pantalla también sirve para cambiar una contraseña propia. Decir
     «primer acceso» y «temporal» a quien no llega obligado sería falso. */
  const [forced, setForced] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  /* Quien llega aquí ya inició sesión: con la clave temporal el backend
     responde PASSWORD_CHANGE_REQUIRED en todo lo demás, así que esta pantalla
     no tiene salida lateral. Sin sesión, de vuelta al login. */
  useEffect(() => {
    let active = true;
    /* Una sola rama asíncrona: con la sesión ya en memoria se resuelve al
       instante, y sin ella se pide el refresh. Así no hay un setState
       síncrono dentro del efecto ni un salto de hidratación. */
    const known = getCurrentUser();
    void (known ? Promise.resolve(known) : refreshSession()).then((user) => {
      if (!active) return;
      if (!user) { router.replace("/"); return; }
      setUsername(user.username); setForced(user.mustChangePassword === true);
    });
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < minimum) { setError(`La contraseña nueva necesita al menos ${minimum} caracteres.`); return; }
    if (newPassword === currentPassword) { setError("La contraseña nueva debe ser distinta de la actual."); return; }
    if (newPassword !== repeated) { setError("Las dos contraseñas no coinciden."); return; }
    setPending(true); setError("");
    try {
      await changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cambiar la contraseña");
      setPending(false);
    }
  }

  if (done) return <main className={styles.page}><section className={styles.card}>
    <div className={styles.logo}><BrandLogo /></div>
    <div className={styles.heading}><p>listo</p><h1>contraseña actualizada</h1><span>Se cerraron las sesiones abiertas. Entra de nuevo con tu contraseña.</span></div>
    <ActionButton stretch onClick={() => router.replace("/")}>ir a iniciar sesión</ActionButton>
  </section></main>;

  return <main className={styles.page}>
    <motion.section className={styles.card} aria-labelledby="change-title"
      initial={reduceMotion ? false : { opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={reduceMotion ? { duration: 0 } : enterTransition}>
      <div className={styles.logo}><BrandLogo /></div>
      <div className={styles.heading}>
        <p>{forced ? "primer acceso" : "tu cuenta"}</p>
        <h1 id="change-title">cambia tu contraseña</h1>
        <span>{forced
          ? `${username ? `Entraste como ${username} con una contraseña temporal. ` : ""}Elige una propia para poder operar.`
          : `${username ? `Estás cambiando la contraseña de ${username}. ` : ""}Se cerrarán las sesiones abiertas.`}</span>
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <label><span>{forced ? "contraseña temporal" : "contraseña actual"}</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(""); }} autoFocus /></label>
        <label><span>contraseña nueva</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(""); }} /></label>
        <label><span>repite la contraseña nueva</span><input type="password" autoComplete="new-password" value={repeated} onChange={(event) => { setRepeated(event.target.value); setError(""); }} /></label>
        <p className={styles.hint}>Al menos {minimum} caracteres, distinta de la {forced ? "temporal" : "actual"}.</p>
        <p id="change-error" className={styles.error} role="alert" aria-live="polite">{error}</p>
        <ActionButton type="submit" disabled={pending} stretch>{pending ? "guardando…" : "cambiar contraseña"}</ActionButton>
      </form>
    </motion.section>
  </main>;
}
