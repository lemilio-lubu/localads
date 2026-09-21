"use client";

import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { FormEvent, useState } from "react";
import ActionButton from "./components/action-button";
import BrandLogo from "./components/brand-logo";
import { enterTransition } from "./design-system/motion";
import { homeFor, login } from "./lib/auth-api";
import styles from "./login-form.module.css";

export default function LoginForm() {
  const router = useRouter(); const reduceMotion = useReducedMotion();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submitLogin(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setPending(true); try { const user = await login(username.trim().toLowerCase(), password); router.push(homeFor(user)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Usuario o contraseña incorrectos"); setPending(false); } }
  function fillDemoAccount(type: "prepago" | "flex" | "admin" | "gestor") { setUsername(type); setPassword("1234"); setError(""); }
  return <main className={styles.loginPage}><motion.section className={styles.loginCard} aria-labelledby="login-title" initial={reduceMotion ? false : { opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={reduceMotion ? { duration: 0 } : enterTransition}>
    <div className={styles.logo}><BrandLogo /></div><div className={styles.heading}><p>portal seguro</p><h1 id="login-title">iniciar sesión</h1><span>Ingresa con tu cuenta de cliente o administrador.</span></div>
    <form className={styles.form} onSubmit={submitLogin}><label><span>usuario</span><input name="username" autoComplete="username" value={username} onChange={(e) => { setUsername(e.target.value); setError(""); }} placeholder="Ingresa tu usuario" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} required autoFocus /></label><label><span>contraseña</span><input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="Ingresa tu contraseña" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} required /></label><p id="login-error" className={styles.error} role="alert" aria-live="polite">{error}</p><ActionButton type="submit" disabled={pending} stretch>{pending ? "verificando…" : "ingresar"}</ActionButton></form>
    <div className={styles.demoAccess}><p>accesos de demostración</p><div><button type="button" onClick={() => fillDemoAccount("prepago")}><strong>prepago</strong><span>prepago / 1234</span></button><button type="button" onClick={() => fillDemoAccount("admin")}><strong>admin</strong><span>admin / 1234</span></button><button type="button" onClick={() => fillDemoAccount("gestor")}><strong>gestor</strong><span>gestor / 1234</span></button><button type="button" onClick={() => fillDemoAccount("flex")}><strong>flex</strong><span>flex / 1234</span></button></div></div>
  </motion.section></main>;
}
