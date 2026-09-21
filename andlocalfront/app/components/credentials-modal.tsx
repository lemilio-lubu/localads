"use client";

import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import ModalShell from "./modal-shell";
import styles from "./credentials-modal.module.css";

export type IssuedCredentials = { username: string; temporaryPassword: string };

type Props = { credentials: IssuedCredentials | null; title: string; onClose: () => void };

/* La clave temporal se muestra una vez y no vuelve a salir por ningún GET.
   Cerrar exige confirmación explícita porque es información irrecuperable: si
   se pierde, hay que restablecerla y volver a avisar a quien la usa. */
export default function CredentialsModal({ credentials, title, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`usuario: ${credentials.username}\ncontraseña temporal: ${credentials.temporaryPassword}`);
      setCopied(true);
    } catch {
      /* Sin permiso de portapapeles el usuario todavía puede leerla en
         pantalla y transcribirla: no es un error que deba interrumpir. */
      setCopied(false);
    }
  }

  function close() { setCopied(false); setAcknowledged(false); onClose(); }

  return (
    <ModalShell open={Boolean(credentials)} labelledBy="credentials-title" className={styles.modal} onClose={close}>
      <h2 id="credentials-title"><KeyRound size={18} aria-hidden="true" />{title}</h2>
      <p className={styles.warning} role="alert"><TriangleAlert size={16} aria-hidden="true" />Esta contraseña no se vuelve a mostrar. Cópiala y entrégasela ahora.</p>

      <dl className={styles.credentials}>
        <div><dt>usuario</dt><dd>{credentials?.username}</dd></div>
        <div><dt>contraseña temporal</dt><dd className={styles.secret}>{credentials?.temporaryPassword}</dd></div>
      </dl>

      <p className={styles.hint}>Al entrar, el sistema le pedirá cambiarla antes de poder operar.</p>

      <div className={styles.actions}>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? "copiado" : "copiar credenciales"}
        </button>
        <label className={styles.acknowledge}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          ya la guardé
        </label>
        <button type="button" className={styles.done} disabled={!acknowledged} onClick={close}>cerrar</button>
      </div>
      <p aria-live="polite" className={styles.live}>{copied ? "Credenciales copiadas al portapapeles" : ""}</p>
    </ModalShell>
  );
}
