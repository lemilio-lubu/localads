"use client";

import { CalendarClock, ChevronLeft, ChevronRight, FileText, Layers, Search, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ModalShell from "../../components/modal-shell";
import ActionButton from "../../components/action-button";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import PlatformPill from "../../components/platform-pill";
import SegmentedFilter, { type SegmentOption } from "../../components/segmented-filter";
import StatusPill from "../../components/status-pill";
import type { AdvertisingPlatform } from "../../design-system/types";
import { completeTransaction, completeTransactionDetail, getAdminTransactionDetail, getAdminTransactionsPage, resumeTransactionDetail, startTransactionRecharge, type AdminTransactionDetail } from "../../lib/admin-recharges-api";
import type { TransactionListItem } from "../../lib/recharges-api";
import { dueLabel, formatAmount, formatDateTime, formatPercent } from "../../lib/format";
import { invoiceStatusLabel, paymentStatusLabel, rechargeStatusLabel, transactionDetailStatusLabel } from "../../lib/status-labels";
import styles from "./transactions-dashboard.module.css";
import { paymentStatusTone, rechargeStatusTone } from "../../lib/status-tone";

const clock = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });
const PAGE_SIZE = 20;

/* Mismo control segmentado que Clientes: el tipo de cuenta es excluyente y
   «todos» tiene que verse, no deducirse apagando el filtro encendido. */
const accountSegments: SegmentOption<"PREPAGO" | "POSTPAGO" | null>[] = [
  { value: null, label: "todos", Icon: Layers, tone: "neutral" },
  { value: "POSTPAGO", label: "postpago", Icon: CalendarClock, tone: "teal" },
  { value: "PREPAGO", label: "prepago", Icon: Wallet, tone: "brand" },
];



export default function TransactionsDashboard() {
  const revision = usePlatformUpdates();
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState("");
  /* Montos realmente recargados en cada plataforma. Arrancan en lo solicitado
     porque es el caso normal, pero el backend acepta que difieran y por eso
     este paso no puede automatizarse. */
  const [effective, setEffective] = useState<Record<string, string>>({});
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [selected, setSelected] = useState<AdminTransactionDetail | null>(null);
  const [query, setQuery] = useState(""); const [search, setSearch] = useState(""); const [type, setType] = useState<"PREPAGO" | "POSTPAGO" | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState("");
  const [pageInfo, setPageInfo] = useState({ totalItems: 0, totalPages: 1, totals: { pautaAmount: 0, totalAmount: 0 } });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState<{ code: string; ok: boolean } | null>(null);

  /* La búsqueda va al servidor, así que se espera a que el administrador deje de
     escribir en vez de pedir una consulta por tecla. */
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  /* Cualquier cambio de filtro devuelve a la primera página: quedarse en la 3 de
     un resultado que ahora tiene una sola muestra una lista vacía. */
  function changeQuery(value: string) { setQuery(value); setPageNumber(1); }
  function changeType(value: "PREPAGO" | "POSTPAGO" | null) { setType(value); setPageNumber(1); }

  useEffect(() => { let active = true; getAdminTransactionsPage({ page: pageNumber, limit: PAGE_SIZE, search: search || undefined, accountType: type ?? undefined }).then((page) => { if (active) { setError(""); setTransactions(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages, totals: page.totals }); setUpdatedAt(new Date()); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar las transacciones"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [pageNumber, search, type, revision]);

  const selectedId = selected?.id;
  useEffect(() => { if (!selectedId) return; let active = true; getAdminTransactionDetail(selectedId).then((next) => { if (active) setSelected(next); }).catch(() => undefined); return () => { active = false; }; }, [selectedId, revision]);
  /* Los tres pasos de ejecución comparten forma: bloquear, llamar, refrescar
     detalle y listado. El saldo de la pauta se mueve en el segundo. */
  async function runExecution(key: string, action: () => Promise<unknown>) {
    if (!selected || resuming) return;
    const transactionId = selected.id;
    setResuming(key); setResumeError("");
    try {
      await action();
      const next = await getAdminTransactionDetail(transactionId);
      setSelected((current) => current?.id === transactionId ? next : current);
      const page = await getAdminTransactionsPage({ page: pageNumber, limit: PAGE_SIZE, search: search || undefined, accountType: type ?? undefined });
      setTransactions(page.items);
      setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages, totals: page.totals });
    } catch (reason) { setResumeError(reason instanceof Error ? reason.message : "No fue posible completar la operación"); }
    finally { setResuming(null); }
  }

  async function resume(detailId: string) {
    if (!selected || resuming) return;
    const transactionId = selected.id;
    setResuming(detailId); setResumeError("");
    try {
      const detail = selected.details.find((item) => item.id === detailId);
      if (detail?.version === undefined) throw new Error("Actualiza el detalle antes de reanudar");
      await resumeTransactionDetail(transactionId, detailId, detail.version);
      const next = await getAdminTransactionDetail(transactionId);
      setSelected((current) => current?.id === transactionId ? next : current);
      setTransactions((current) => current.map((item) => item.id === transactionId ? { ...item, pausedDetails: next.details.filter((detail) => detail.pausedAt).length } : item));
    } catch (reason) { setResumeError(reason instanceof Error ? reason.message : "No fue posible reanudar la recarga"); }
    finally { setResuming(null); }
  }

  const rangeLabel = useMemo(() => {
    if (!pageInfo.totalItems) return "0 resultados";
    const first = (pageNumber - 1) * PAGE_SIZE + 1;
    return `${first}-${Math.min(first + transactions.length - 1, pageInfo.totalItems)} de ${pageInfo.totalItems}`;
  }, [pageInfo.totalItems, pageNumber, transactions.length]);

  /* El portapapeles puede negarse (permiso, contexto inseguro, foco perdido) y
     entonces el clic no haría nada visible. El fallo se dice y se deja el código
     seleccionado para copiarlo a mano. */
  async function copyCode(code: string, element: HTMLElement | null) {
    let ok = true;
    try { await navigator.clipboard.writeText(code); }
    catch { ok = false; if (element) window.getSelection()?.selectAllChildren(element); }
    setCopied({ code, ok });
    window.setTimeout(() => setCopied((current) => current?.code === code ? null : current), 2400);
  }

  function copyLabel(code: string) {
    if (copied?.code !== code) return "copiar";
    return copied.ok ? "copiado" : "no se pudo";
  }
  async function open(id: string) { setDetailLoading(true); setError(""); setResumeError(""); try { setSelected(await getAdminTransactionDetail(id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar el detalle"); } finally { setDetailLoading(false); } }

  return <div className={styles.module}>
    <div className={styles.toolbar}><label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Buscar por cliente o código" /></label><div className={styles.filters}><div className={styles.filterGroup}><span>tipo de cuenta</span><SegmentedFilter label="Tipo de cuenta" options={accountSegments} value={type} onChange={changeType} /></div></div></div>
    <div className={styles.overview}><div><small>transacciones</small><strong>{pageInfo.totalItems}</strong></div><div><small>inversión en pauta</small><strong>{formatAmount(pageInfo.totals.pautaAmount)}</strong></div><div><small>total facturable</small><strong>{formatAmount(pageInfo.totals.totalAmount)}</strong></div></div>
    <div className={styles.listMeta}><span>{rangeLabel}</span><span>{updatedAt ? `actualizado a las ${clock.format(updatedAt)}` : "consultando…"}</span></div>
    <div className={styles.list} aria-live="polite" aria-busy={loading || detailLoading}>
      {transactions.map((item) => <article key={item.id} className={styles.row}>
        <div className={styles.cell}><strong>cliente</strong><span className={styles.clientName} title={item.clientName}>{item.clientName}</span></div>
        <div className={styles.cell}><strong>fecha</strong><span>{formatDateTime(item.createdAt)}</span></div>
        <div className={`${styles.cell} ${styles.codeCell}`} data-account={item.accountTypeSnapshot}><strong>{item.accountTypeSnapshot === "POSTPAGO" ? <CalendarClock size={14} aria-hidden="true" /> : <Wallet size={14} aria-hidden="true" />}código {item.accountTypeSnapshot.toLowerCase()}</strong>
          <button type="button" className={styles.copyCode} data-state={copied?.code === item.code ? (copied.ok ? "done" : "failed") : undefined} title={item.code} onClick={(event) => void copyCode(item.code, event.currentTarget.querySelector("span"))}>
            <span>{item.code}</span><small>{copyLabel(item.code)}</small>
          </button>
        </div>
        <div className={styles.cell}><strong>inversión / total</strong><span className={styles.amount}>{formatAmount(item.pautaAmount)}</span><span className={styles.totalDue}>a pagar {formatAmount(item.totalAmount)}</span></div>
        <div className={styles.cell}><strong>recarga / pago</strong><div className={styles.statuses}><StatusPill tone={rechargeStatusTone(item.rechargeStatus)}>{rechargeStatusLabel(item.rechargeStatus)}</StatusPill>{Boolean(item.pausedDetails) && <StatusPill tone="neutral">{`${item.pausedDetails} en stop`}</StatusPill>}<StatusPill tone={paymentStatusTone(item.paymentStatus)}>{paymentStatusLabel(item.paymentStatus)}</StatusPill></div>
          {item.dueDate && (item.paymentStatus === "IN_CREDIT" || item.paymentStatus === "OVERDUE") && <span className={`${styles.dueDate} ${item.paymentStatus === "OVERDUE" ? styles.dueOverdue : ""}`}>{dueLabel(item.dueDate)}</span>}
        </div>
        <div className={styles.platforms} aria-label="Plataformas">{item.platforms.map((platform) => <PlatformPill key={platform} platform={platform.toLowerCase() as AdvertisingPlatform} size="compact" />)}</div>
        <button type="button" className={styles.detailsButton} aria-haspopup="dialog" disabled={detailLoading} onClick={() => void open(item.id)}>ver detalles</button>
      </article>)}
      {loading && <><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /></>}
      {!loading && error && <p className={`${styles.message} ${styles.errorMessage}`} role="alert">{error}</p>}
      {!loading && !error && !transactions.length && <p className={styles.message}>No hay transacciones para los filtros seleccionados.</p>}
    </div>

    {pageInfo.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de transacciones">
      <button type="button" disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><ChevronLeft size={16} aria-hidden="true" />anterior</button>
      <span aria-live="polite">página {pageNumber} de {pageInfo.totalPages}</span>
      <button type="button" disabled={pageNumber >= pageInfo.totalPages || loading} onClick={() => setPageNumber((value) => Math.min(pageInfo.totalPages, value + 1))}>siguiente<ChevronRight size={16} aria-hidden="true" /></button>
    </nav>}

    <ModalShell open={Boolean(selected)} labelledBy="transaction-title" onClose={() => setSelected(null)} className={styles.modal}>{selected && <>
      <header className={styles.modalHeader}><div><small>transacción</small><h2 id="transaction-title">{selected.clientName}</h2><p className={styles.codeCell}><button type="button" className={styles.copyCode} data-state={copied?.code === selected.code ? (copied.ok ? "done" : "failed") : undefined} title={selected.code} onClick={(event) => void copyCode(selected.code, event.currentTarget.querySelector("span"))}><span>{selected.code}</span><small>{copyLabel(selected.code)}</small></button></p></div><StatusPill tone={rechargeStatusTone(selected.rechargeStatus)}>{rechargeStatusLabel(selected.rechargeStatus)}</StatusPill></header>
      <div className={styles.detailGrid}><section className={styles.receiptPanel}><div className={styles.sectionTitle}><FileText size={20} aria-hidden="true" /><div><small>resumen financiero</small><strong>{selected.details.length} {selected.details.length === 1 ? "plataforma" : "plataformas"}</strong></div></div><dl><div><dt>pauta</dt><dd>{formatAmount(selected.pautaAmount)}</dd></div><div><dt>ISD <em>{formatPercent(selected.isdRate)}</em></dt><dd>{formatAmount(selected.isdAmount)}</dd></div><div><dt>comisión <em>{formatPercent(selected.agencyFeeRate)}</em></dt><dd>{formatAmount(selected.agencyFeeAmount)}</dd></div><div><dt>IVA <em>{formatPercent(selected.vatRate)}</em></dt><dd>{formatAmount(selected.vatAmount)}</dd></div><div className={styles.totalRow}><dt>total facturable</dt><dd>{formatAmount(selected.totalAmount)}</dd></div><div className={styles.paymentRow}><dt>pago</dt><dd><StatusPill tone={paymentStatusTone(selected.payment?.status)}>{paymentStatusLabel(selected.payment?.status)}</StatusPill></dd></div></dl></section><section className={styles.historyPanel}><small>detalles de pauta</small><ol>{selected.details.map((detail) => <li key={detail.id}><span className={styles.timelineDot} /><div><strong>{detail.platform} · {formatAmount(detail.requestedAmount)}</strong><p>{detail.pausedAt ? "stop · pausada" : transactionDetailStatusLabel(detail.status)} · total {formatAmount(detail.totalAmount)}</p><time>{detail.effectiveRechargeDate ? formatDateTime(detail.effectiveRechargeDate) : "pendiente de ejecución"}</time>{detail.pausedAt && <><p>{detail.pautaStatus !== "ACTIVE" ? "Reactiva la plataforma antes de reanudar." : "Reanudación manual; se validará el pago."}</p><ActionButton type="button" disabled={Boolean(resuming) || detail.pautaStatus !== "ACTIVE"} onClick={() => void resume(detail.id)}>{resuming === detail.id ? "Reanudando…" : "Reanudar recarga"}</ActionButton></>}
              {selected.rechargeStatus === "PROCESSING" && !detail.pausedAt && detail.status !== "COMPLETED" && <div className={styles.executeDetail}>
                <label htmlFor={`effective-${detail.id}`}>monto recargado</label>
                <input id={`effective-${detail.id}`} type="number" min="0.01" step="0.01" inputMode="decimal" value={effective[detail.id] ?? String(detail.requestedAmount)} onChange={(event) => setEffective((current) => ({ ...current, [detail.id]: event.target.value }))} />
                <button type="button" disabled={Boolean(resuming)} onClick={() => void runExecution(detail.id, () => completeTransactionDetail(selected.id, detail.id, effective[detail.id] ?? String(detail.requestedAmount)))}>{resuming === detail.id ? "Acreditando…" : "marcar como recargada"}</button>
              </div>}</div></li>)}</ol></section></div>
      {(selected.rechargeStatus === "APPROVED" || selected.rechargeStatus === "PROCESSING") && <div className={styles.executeBar}>
        {selected.rechargeStatus === "APPROVED"
          ? <><p>Aprobada: el saldo del cliente no se mueve hasta ejecutar la recarga.</p><ActionButton type="button" disabled={Boolean(resuming)} onClick={() => void runExecution("start", () => startTransactionRecharge(selected.id))}>{resuming === "start" ? "Iniciando…" : "Iniciar recarga"}</ActionButton></>
          : selected.details.every((detail) => detail.status === "COMPLETED")
            ? <><p>Todas las plataformas acreditadas. Al completar se emite la factura.</p><ActionButton type="button" disabled={Boolean(resuming)} onClick={() => void runExecution("complete", () => completeTransaction(selected.id))}>{resuming === "complete" ? "Completando…" : "Completar recarga"}</ActionButton></>
            : <p>En proceso: registra abajo el monto recargado en cada plataforma.</p>}
      </div>}
      {resumeError && <p className={`${styles.message} ${styles.errorMessage}`} role="alert">{resumeError}</p>}
      <footer className={styles.auditFooter}><span>Factura: {selected.invoice ? `${selected.invoice.invoiceNumber} · ${invoiceStatusLabel(selected.invoice.status)}` : "se emitirá al completar"}</span><span>{selected.verifications.length} {selected.verifications.length === 1 ? "verificación registrada" : "verificaciones registradas"}</span></footer>
    </>}</ModalShell>
  </div>;
}
