"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import Button from "../../components/atoms/button";
import TextButton from "../../components/atoms/text-button";
import ModalShell from "../../components/organisms/modal-shell";
import { retryInvoice, type InvoiceRetryResult, type UnissuedInvoice } from "../../lib/admin-invoices-api";
import { formatAmount } from "../../lib/format";
import styles from "./unissued-invoices.module.css";

/* Lo que pasó al reintentar, dicho para quien no ve los logs. Un fallo trae
   su propio motivo y se muestra tal cual. */
const retryOutcome: Record<Exclude<InvoiceRetryResult["status"], "FAILED">, string> = {
  AUTHORIZED: "Factura emitida y autorizada por el SRI.",
  SUBMITTED: "Enviada a Migo. Falta la respuesta del SRI.",
  ALREADY_AUTHORIZED: "La factura ya estaba autorizada.",
  IN_PROGRESS: "Ya hay un intento en curso. Vuelve a mirar en un minuto.",
  MANUAL: "Esta factura se emite a mano, fuera del sistema.",
  DISABLED: "La facturación electrónica está desactivada.",
};

function waitLabel(nextAttemptAt: string | null, checkedAt: Date) {
  if (!nextAttemptAt) return "próximo intento en menos de un minuto";
  const minutes = Math.ceil((new Date(nextAttemptAt).getTime() - checkedAt.getTime()) / 60_000);
  return minutes <= 1 ? "próximo intento en menos de un minuto" : `próximo intento en ${minutes} min`;
}

const pendingLabel = (hours: number) => hours < 1 ? "pendiente hace menos de una hora" : hours < 48 ? `pendiente hace ${hours} h` : `pendiente hace ${Math.floor(hours / 24)} días`;

type IssueProps = {
  invoice: UnissuedInvoice;
  checkedAt: Date;
  /* Tras reintentar, quien muestra la lista la vuelve a pedir. */
  onChanged: () => void;
  /* En el detalle de una transacción el cliente y el código ya están a la vista. */
  showOwner?: boolean;
  /* El reintento la sacó de la lista de fallos: quien la muestra guarda el
     resultado, porque esta fila deja de existir al refrescar. */
  onSettled?: (invoice: UnissuedInvoice, text: string) => void;
};

/**
 * Una factura que no ha salido: por qué, cuántos intentos lleva y el botón
 * para pedirla ya. La que espera al SRI no tiene nada que reintentar.
 */
export function UnissuedInvoiceIssue({ invoice, checkedAt, onChanged, showOwner = true, onSettled }: IssueProps) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function retry() {
    setPending(true); setOutcome(null);
    try {
      const result = await retryInvoice(invoice.invoiceId);
      if (result.status === "FAILED") setOutcome({ ok: false, text: result.reason ?? "No se pudo emitir la factura." });
      else if (result.status === "AUTHORIZED" || result.status === "SUBMITTED") onSettled?.(invoice, retryOutcome[result.status]);
      else setOutcome({ ok: true, text: retryOutcome[result.status] });
      onChanged();
    } catch (reason) {
      setOutcome({ ok: false, text: reason instanceof Error ? reason.message : "No fue posible reintentar" });
    } finally { setPending(false); }
  }

  const failing = invoice.state === "FAILING";
  return (
    <article className={styles.issue} data-state={invoice.state}>
      {showOwner && <header className={styles.owner}>
        <strong>{invoice.clientName}</strong>
        <span>{invoice.transactionCode} · {formatAmount(Number(invoice.totalAmount))}</span>
      </header>}
      {failing
        ? <p className={styles.reason}>{invoice.reason}</p>
        : <p className={styles.waiting}>{invoice.state === "WAITING_SRI" ? `Enviada a Migo${invoice.fiscalNumber ? ` como ${invoice.fiscalNumber}` : ""}. Falta la respuesta del SRI.` : "En cola: se envía en el siguiente intento."}</p>}
      {failing && <div className={styles.meta}>
        <span>intento {invoice.attempts} · {waitLabel(invoice.nextAttemptAt, checkedAt)} · {pendingLabel(invoice.pendingHours)}</span>
        <Button variant="secondary" size="compact" disabled={pending} onClick={() => void retry()}>{pending ? "Reintentando…" : "Reintentar ahora"}</Button>
      </div>}
      {outcome && <p className={outcome.ok ? styles.outcome : styles.outcomeError} role={outcome.ok ? "status" : "alert"}>{outcome.text}</p>}
    </article>
  );
}

/**
 * La factura de una transacción dentro de su detalle: el fallo con su botón
 * o, tras reintentarla con éxito, lo que pasó.
 */
export function TransactionInvoiceIssue({ invoices, invoiceId, checkedAt, onChanged }: Props & { invoiceId: string }) {
  const [settled, setSettled] = useState("");
  const invoice = invoices.find((item) => item.invoiceId === invoiceId);
  if (settled) return <p className={styles.settled} role="status">{settled}</p>;
  if (!invoice) return null;
  return <UnissuedInvoiceIssue invoice={invoice} checkedAt={checkedAt} onChanged={onChanged} showOwner={false} onSettled={(_, text) => setSettled(text)} />;
}

type Props = { invoices: UnissuedInvoice[]; checkedAt: Date; onChanged: () => void };

/**
 * Aviso de facturas que no se han podido emitir, con su lista. Solo aparece
 * si alguna está fallando: mientras todo sale, la pantalla no cambia.
 */
export default function UnissuedInvoices({ invoices, checkedAt, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  /* Las que un reintento resolvió mientras el panel está abierto. */
  const [settled, setSettled] = useState<{ invoice: UnissuedInvoice; text: string }[]>([]);
  const settle = (invoice: UnissuedInvoice, text: string) => setSettled((current) => [...current.filter((item) => item.invoice.invoiceId !== invoice.invoiceId), { invoice, text }]);
  const settledIds = new Set(settled.map((item) => item.invoice.invoiceId));
  const failing = invoices.filter((invoice) => invoice.state === "FAILING");
  const waiting = invoices.filter((invoice) => invoice.state !== "FAILING" && !settledIds.has(invoice.invoiceId));
  /* Abierto, el panel no se cierra solo cuando el reintento arregla la última:
     el resultado se queda a la vista. */
  if (!failing.length && !open) return null;

  return <>
    {failing.length > 0 && <p className={styles.notice} role="status">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>{failing.length === 1 ? "1 factura no se ha podido emitir" : `${failing.length} facturas no se han podido emitir`}</span>
      <TextButton size="inherit" tone="inherit" onClick={() => { onChanged(); setOpen(true); }}>ver por qué</TextButton>
    </p>}
    <ModalShell open={open} labelledBy="unissued-invoices-title" className={styles.modal} onClose={() => { setOpen(false); setSettled([]); }}>
      <h2 id="unissued-invoices-title">facturas sin emitir</h2>
      <p className={styles.lead}>El sistema las reintenta solo, cada vez más espaciado. Si ya corregiste la causa, reinténtala aquí.</p>
      {settled.length > 0 && <div className={styles.issues}>{settled.map(({ invoice, text }) => <article key={invoice.invoiceId} className={styles.issue}>
        <header className={styles.owner}><strong>{invoice.clientName}</strong><span>{invoice.transactionCode} · {formatAmount(Number(invoice.totalAmount))}</span></header>
        <p className={styles.settled} role="status">{text}</p>
      </article>)}</div>}
      {failing.length > 0
        ? <div className={styles.issues}>{failing.map((invoice) => <UnissuedInvoiceIssue key={invoice.invoiceId} invoice={invoice} checkedAt={checkedAt} onChanged={onChanged} onSettled={settle} />)}</div>
        : <p className={styles.empty}>No queda ninguna factura con fallo.</p>}
      {waiting.length > 0 && <>
        <h3 className={styles.subtitle}>en camino</h3>
        <div className={styles.issues}>{waiting.map((invoice) => <UnissuedInvoiceIssue key={invoice.invoiceId} invoice={invoice} checkedAt={checkedAt} onChanged={onChanged} />)}</div>
      </>}
    </ModalShell>
  </>;
}
