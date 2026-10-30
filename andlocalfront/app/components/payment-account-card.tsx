"use client";

import { Check, Copy } from "lucide-react";
import { MouseEvent, ReactNode, useEffect, useState } from "react";
import { formatAmount, formatDay } from "../lib/format";
import Disclosure from "./disclosure";
import styles from "./payment-account-card.module.css";

type Account = { bankName: string; accountType: string; accountNumber: string; holderName: string; holderTaxId: string; email: string | null; phone: string | null; updatedAt?: string };
type Props = {
  account: Account;
  /* La referencia estable del cliente; sin ella (equipo) la fila no aparece. */
  reference?: string | null;
  /* Todo el bloque en texto, ya armado por quien lo usa, para «copiar todo». */
  copyAllText?: string;
  /* Lo que se va a transferir ahora; va en el título y así el monto vive en un solo sitio. */
  amount?: number | null;
  note?: ReactNode;
  /* Para columnas estrechas: apila etiqueta y valor. */
  compact?: boolean;
  /* Solo para leer: sin botones de copiar. Es la vista previa del admin, que revisa y no copia. */
  quiet?: boolean;
  /* La versión para aprender y consultar con calma («cómo pagar»): explica la referencia y dice cuándo se actualizó. */
  detailed?: boolean;
};

type Field = { key: string; label: string; value: string; copyLabel: string };

/* Los datos que el cliente teclea en su banco, cada uno con su botón de copiar:
   la app es una PWA y suele estar abierta junto a la del banco, así que copiar
   es el camino principal y no un extra. El botón es solo un icono (siete
   «copiar» iguales pesaban más que los datos) y la palabra aparece al pulsar,
   que es cuando informa. Si el portapapeles se niega, se dice y el valor queda
   seleccionado para copiarlo a mano. */
export default function PaymentAccountCard({ account, reference, copyAllText, amount, note, compact = false, quiet = false, detailed = false }: Props) {
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);

  /* Si el portapapeles se niega, el valor se selecciona para copiarlo a mano: se busca junto al botón pulsado, sin guardar referencias a elementos. */
  async function copy(key: string, value: string, trigger: HTMLElement | null) {
    let ok = true;
    try { await navigator.clipboard.writeText(value); }
    catch { ok = false; const element = trigger?.parentElement?.querySelector<HTMLElement>("[data-copy-value]"); if (element) window.getSelection()?.selectAllChildren(element); }
    setCopied({ key, ok });
  }
  /* El aviso dura lo justo para leerlo; cada pulsación nueva reinicia la cuenta. */
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const primary: Field[] = [
    { key: "number", label: "número de cuenta", value: account.accountNumber, copyLabel: "Copiar número de cuenta" },
    { key: "holder", label: "titular", value: account.holderName, copyLabel: "Copiar titular" },
    { key: "taxId", label: "RUC / identificación", value: account.holderTaxId, copyLabel: "Copiar RUC o identificación" },
  ];
  const secondary: Field[] = [
    ...(account.email ? [{ key: "email", label: "correo", value: account.email, copyLabel: "Copiar correo" }] : []),
    ...(account.phone ? [{ key: "phone", label: "celular", value: account.phone, copyLabel: "Copiar celular" }] : []),
  ];

  const stateOf = (key: string) => (copied?.key === key ? (copied.ok ? "done" : "failed") : undefined);
  const copyButton = (key: string, label: string, value: string) => {
    const state = stateOf(key);
    return (
      <button type="button" className={styles.copy} data-state={state} aria-label={label} onClick={(event: MouseEvent<HTMLButtonElement>) => void copy(key, value, event.currentTarget)}>
        {state === "done" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {state && <span>{state === "done" ? "copiado" : "cópialo a mano"}</span>}
      </button>
    );
  };

  const row = (field: Field) => (
    <div key={field.key} className={styles.row}>
      <dt>{field.label}</dt>
      <dd>
        <span data-copy-value>{field.value}</span>
        {!quiet && copyButton(field.key, field.copyLabel, field.value)}
      </dd>
    </div>
  );

  return (
    <section className={`${styles.card} ${compact ? styles.compact : ""} ${quiet ? styles.quiet : ""}`} aria-label="Datos para tu transferencia">
      <header className={styles.header}>
        {amount != null
          ? <div>
              <small>transfiere</small>
              <h3>{formatAmount(amount)}</h3>
              <span className={styles.type}>a {account.bankName} · {account.accountType}</span>
            </div>
          : <div>
              <small>transfiere a</small>
              <h3>{account.bankName}</h3>
              <span className={styles.type}>{account.accountType}</span>
            </div>}
        {copyAllText && !quiet && (
          <button type="button" className={styles.copyAll} data-state={stateOf("all")} onClick={(event) => void copy("all", copyAllText, event.currentTarget)}>
            {copied?.key === "all" && copied.ok ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied?.key === "all" ? (copied.ok ? "copiado" : "no se pudo copiar") : "copiar todo"}
          </button>
        )}
      </header>
      <dl className={styles.fields}>{primary.map(row)}</dl>
      {reference && (
        <div className={styles.reference}>
          <div>
            <small>referencia</small>
            <strong data-copy-value>{reference}</strong>
            <span>escríbela en el concepto</span>
          </div>
          {!quiet && copyButton("reference", "Copiar referencia", reference)}
        </div>
      )}
      {reference && detailed && <p className={styles.referenceNote}>Es siempre la misma: guárdala en tu banco una vez y así reconocemos tu pago.</p>}
      {secondary.length > 0 && (
        <Disclosure summaryClassName={styles.optionalSummary} summary="si tu banco pide correo o celular">
          <dl className={styles.fields}>{secondary.map(row)}</dl>
        </Disclosure>
      )}
      {note && <div className={styles.note}>{note}</div>}
      {detailed && account.updatedAt && <p className={styles.updated}>Actualizada el {formatDay(account.updatedAt)}</p>}
      {/* Aviso en vivo para lectores de pantalla: el botón solo es un icono. */}
      <p className={styles.srOnly} role="status" aria-live="polite">{copied ? (copied.ok ? "Copiado" : "No se pudo copiar; cópialo a mano") : ""}</p>
    </section>
  );
}
