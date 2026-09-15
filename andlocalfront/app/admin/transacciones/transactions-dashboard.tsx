"use client";

import { ChevronRight, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ModalShell from "../../components/modal-shell";
import ActionButton from "../../components/action-button";
import { usePlatformUpdates } from "../../lib/use-platform-updates";
import PlatformPill from "../../components/platform-pill";
import StatusPill from "../../components/status-pill";
import ToggleChip from "../../components/toggle-chip";
import type { AdvertisingPlatform } from "../../design-system/types";
import { getAdminTransactionDetail, getAdminTransactionsPage, resumeTransactionDetail, type AdminTransactionDetail } from "../../lib/admin-recharges-api";
import type { TransactionListItem } from "../../lib/recharges-api";
import { invoiceStatusLabel, paymentStatusLabel, rechargeStatusLabel, transactionDetailStatusLabel } from "../../lib/status-labels";
import styles from "./transactions-dashboard.module.css";

const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tone = (value: string | null): "success" | "danger" | "neutral" => value && ["PAID", "COMPLETED", "APPROVED", "IN_CREDIT"].includes(value) ? "success" : value && ["REJECTED", "OVERDUE"].includes(value) ? "danger" : "neutral";

export default function TransactionsDashboard() {
  const revision = usePlatformUpdates();
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState("");
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [selected, setSelected] = useState<AdminTransactionDetail | null>(null);
  const [query, setQuery] = useState(""); const [type, setType] = useState<"PREPAGO" | "POSTPAGO" | null>(null);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState("");
  const [pageInfo, setPageInfo] = useState({ totalItems: 0, totalPages: 1 });

  useEffect(() => { let active = true; getAdminTransactionsPage({ limit: 100, accountType: type ?? undefined }).then((page) => { if (active) { setTransactions(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar las transacciones"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [type, revision]);

  const selectedId = selected?.id;
  useEffect(() => { if (!selectedId) return; let active = true; getAdminTransactionDetail(selectedId).then((next) => { if (active) setSelected(next); }).catch(() => undefined); return () => { active = false; }; }, [selectedId, revision]);
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

  const visible = useMemo(() => { const normalized = query.trim().toLowerCase(); return transactions.filter((item) => !normalized || `${item.code} ${item.clientName} ${item.clientId}`.toLowerCase().includes(normalized)); }, [query, transactions]);
  async function open(id: string) { setDetailLoading(true); setError(""); setResumeError(""); try { setSelected(await getAdminTransactionDetail(id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar el detalle"); } finally { setDetailLoading(false); } }

  return <div className={styles.module}>
    <div className={styles.toolbar}><label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente o código" /></label><div className={styles.filters}><span>tipo de cuenta</span><ToggleChip pressed={type === "POSTPAGO"} onClick={() => setType((value) => value === "POSTPAGO" ? null : "POSTPAGO")}>▣ postpago</ToggleChip><ToggleChip pressed={type === "PREPAGO"} onClick={() => setType((value) => value === "PREPAGO" ? null : "PREPAGO")}>□ prepago</ToggleChip></div></div>
    <div className={styles.overview}><div><small>transacciones</small><strong>{pageInfo.totalItems}</strong></div><div><small>inversión en pauta</small><strong>{money.format(transactions.reduce((sum, item) => sum + item.pautaAmount, 0))}</strong></div><div><small>total facturable</small><strong>{money.format(transactions.reduce((sum, item) => sum + item.totalAmount, 0))}</strong></div></div>
    <div className={styles.listMeta}><span>{visible.length} resultados</span><span>{pageInfo.totalPages > 1 ? `${pageInfo.totalPages} páginas` : "datos actualizados"}</span></div>
    <div className={styles.list} aria-live="polite" aria-busy={loading || detailLoading}>
      {!loading && visible.length > 0 && <div className={styles.rowHeader} aria-hidden="true"><span>cliente</span><span>valor</span><span>pago</span><span>recarga</span><span /></div>}
      {visible.map((item) => <article key={item.id} className={styles.row}><button className={styles.open} type="button" onClick={() => void open(item.id)} aria-label={`Ver transacción ${item.code}`} /><div className={styles.identity}><small>cliente</small><strong>{item.clientName}</strong><span>{item.code}</span></div><div className={styles.metric}><small>valor</small><strong>{money.format(item.totalAmount)}</strong><div className={styles.platformLine}>{item.platforms.map((platform) => <PlatformPill key={platform} platform={platform.toLowerCase() as AdvertisingPlatform} size="compact" />)}</div></div><div className={styles.metric}><small>pago</small><StatusPill tone={tone(item.paymentStatus)}>{paymentStatusLabel(item.paymentStatus)}</StatusPill><span>{item.accountTypeSnapshot.toLowerCase()}</span></div><div className={styles.metric}><small>recarga</small><StatusPill tone={tone(item.rechargeStatus)}>{rechargeStatusLabel(item.rechargeStatus)}</StatusPill>{Boolean(item.pausedDetails) && <StatusPill tone="neutral">{`${item.pausedDetails} en stop`}</StatusPill>}<span>{date.format(new Date(item.createdAt))}</span></div><ChevronRight className={styles.chevron} size={22} aria-hidden="true" /></article>)}
      {loading && <><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /><div className={`${styles.row} ${styles.skeleton}`} aria-hidden="true" /></>}
      {!loading && (error || !visible.length) && <p className={styles.message} role={error ? "alert" : undefined}>{error || "No hay transacciones para los filtros seleccionados."}</p>}
    </div>

    <ModalShell open={Boolean(selected)} labelledBy="transaction-title" onClose={() => setSelected(null)} className={styles.modal}>{selected && <>
      <header className={styles.modalHeader}><div><small>transacción</small><h2 id="transaction-title">{selected.clientName}</h2><p>{selected.code}</p></div><StatusPill tone={tone(selected.rechargeStatus)}>{rechargeStatusLabel(selected.rechargeStatus)}</StatusPill></header>
      <div className={styles.detailGrid}><section className={styles.receiptPanel}><div className={styles.sectionTitle}><FileText size={20} aria-hidden="true" /><div><small>resumen financiero</small><strong>{selected.details.length} {selected.details.length === 1 ? "plataforma" : "plataformas"}</strong></div></div><dl><div><dt>pauta</dt><dd>{money.format(selected.pautaAmount)}</dd></div><div><dt>ISD</dt><dd>{money.format(selected.isdAmount)}</dd></div><div><dt>comisión</dt><dd>{money.format(selected.agencyFeeAmount)}</dd></div><div><dt>IVA</dt><dd>{money.format(selected.vatAmount)}</dd></div><div><dt>total</dt><dd>{money.format(selected.totalAmount)}</dd></div><div><dt>pago</dt><dd>{paymentStatusLabel(selected.payment?.status)}</dd></div></dl></section><section className={styles.historyPanel}><small>detalles de pauta</small><ol>{selected.details.map((detail) => <li key={detail.id}><span className={styles.timelineDot} /><div><strong>{detail.platform} · {money.format(detail.requestedAmount)}</strong><p>{detail.pausedAt ? "stop · pausada" : transactionDetailStatusLabel(detail.status)} · total {money.format(detail.totalAmount)}</p><time>{detail.effectiveRechargeDate ? date.format(new Date(detail.effectiveRechargeDate)) : "pendiente de ejecución"}</time>{detail.pausedAt && <><p>{detail.pautaStatus !== "ACTIVE" ? "Reactiva la plataforma antes de reanudar." : "Reanudación manual; se validará el pago."}</p><ActionButton type="button" disabled={Boolean(resuming) || detail.pautaStatus !== "ACTIVE"} onClick={() => void resume(detail.id)}>{resuming === detail.id ? "Reanudando…" : "Reanudar recarga"}</ActionButton></>}</div></li>)}</ol></section></div>
      {resumeError && <p className={styles.message} role="alert">{resumeError}</p>}
      <footer className={styles.auditFooter}><span>Factura: {selected.invoice ? `${selected.invoice.invoiceNumber} · ${invoiceStatusLabel(selected.invoice.status)}` : "se emitirá al completar"}</span><span>{selected.verifications.length} verificaciones registradas</span></footer>
    </>}</ModalShell>
  </div>;
}
