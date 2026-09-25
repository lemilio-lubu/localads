"use client";

import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import ActionButton from "./components/action-button";
import BrandLogo from "./components/brand-logo";
import { FormError, FormField, formStyles as form } from "./components/form-modal";
import { homeFor, login } from "./lib/auth-api";
import LoginWalletDeck, { type DeckState } from "./login-wallet-deck";
import styles from "./login-form.module.css";

type Field = "username" | "password";
const demoAccounts = ["prepago", "flex", "gestor", "admin"] as const;

export default function LoginForm() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [deck, setDeck] = useState<DeckState>("idle");
  const pending = deck !== "idle";

  /* noValidate: el globo nativo («Completa este campo») habla con la voz del
     navegador y tapaba el campo. Los mensajes los escribe el producto, junto
     a cada campo, y solo tras intentar entrar. */
  const fieldErrors: Partial<Record<Field, string>> = {
    ...(username.trim() ? {} : { username: "Escribe tu usuario." }),
    ...(password ? {} : { password: "Escribe tu contraseña." }),
  };
  const shown = (field: Field) => (submitted ? fieldErrors[field] : undefined);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true); setError("");
    if (Object.keys(fieldErrors).length) {
      const formElement = event.currentTarget;
      requestAnimationFrame(() => (formElement.querySelector("[aria-invalid='true']") as HTMLElement | null)?.focus());
      return;
    }
    // Mientras se verifica, las tarjetas se juntan en un mazo.
    setDeck("gathering");
    try {
      const user = await login(username.trim().toLowerCase(), password);
      // Al entrar, el mazo despega antes de cambiar de pantalla.
      setDeck("launching");
      window.setTimeout(() => router.push(homeFor(user)), reduceMotion ? 0 : 380);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Usuario o contraseña incorrectos");
      setDeck("idle");
    }
  }

  function fillDemoAccount(account: (typeof demoAccounts)[number]) { setUsername(account); setPassword("1234"); setError(""); }

  /* Los textos entran desenfocados y se enfocan en cascada. */
  const reveal = (delay: number) => reduceMotion
    ? { initial: false as const }
    : { initial: { opacity: 0, y: 12, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const, delay } };

  return (
    <main className={styles.page}>
      {/* Aurora: tres manchas de color de marca, muy difusas y lentas, detrás
          de todo. Decorativa. */}
      <div className={styles.aurora} aria-hidden="true"><span /><span /><span /></div>

      <section className={styles.story} aria-labelledby="login-story-title">
        <LoginWalletDeck state={deck} />
        <div className={styles.storyText}>
          <motion.h2 id="login-story-title" {...reveal(0.55)}>
            Tus plataformas de pauta<span> En una sola billetera</span>
          </motion.h2>
          <motion.p {...reveal(0.7)}>Recarga Meta, Google y TikTok desde Ecuador, con factura local y el saldo de cada una a la vista.</motion.p>
        </div>
      </section>

      <motion.section
        className={styles.panel}
        aria-labelledby="login-title"
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
      >
        <div className={styles.logo}><BrandLogo /></div>
        <header className={styles.heading}>
          <h1 id="login-title">Inicia sesión</h1>
          <p>Clientes, gestores y administradores usan el mismo acceso.</p>
        </header>

        <form className={`${form.form} ${styles.form}`} onSubmit={submitLogin} noValidate>
          <FormField label="Usuario" Icon={UserRound} error={shown("username")}>
            {({ id, describedBy, invalid }) => <input id={id} name="username" autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} placeholder="tu usuario" aria-invalid={invalid} aria-describedby={describedBy} autoFocus disabled={pending} />}
          </FormField>
          <FormField label="Contraseña" Icon={LockKeyhole} error={shown("password")}>
            {({ id, describedBy, invalid }) => <>
              <input id={id} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="tu contraseña" aria-invalid={invalid} aria-describedby={describedBy} className={styles.passwordInput} disabled={pending} />
              <button type="button" className={styles.reveal} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword}>
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </>}
          </FormField>
          <FormError message={error} />
          <ActionButton type="submit" className={styles.submit} disabled={pending} stretch>{deck === "launching" ? "Entrando…" : pending ? "Verificando…" : "Continuar"}</ActionButton>
        </form>

        {/* Solo para probar: una línea discreta, no un bloque que compita con
            el acceso real. */}
        <p className={styles.demo}>
          Probar con una cuenta demo:{" "}
          {demoAccounts.map((account, index) => <span key={account}>{index > 0 && " · "}<button type="button" onClick={() => fillDemoAccount(account)} disabled={pending}>{account}</button></span>)}
        </p>
      </motion.section>
    </main>
  );
}
