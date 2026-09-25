"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import MetricCard from "../../components/metric-card";
import ModalShell from "../../components/modal-shell";
import PlatformPill from "../../components/platform-pill";
import { daysUntil, formatAmount, formatDateTime, formatDay } from "../../lib/format";
import { paymentStatusLabel, rechargeStatusLabel } from "../../lib/status-labels";
import type { AdvertisingPlatform } from "../../design-system/types";
import { getAdminClientDetail, type AdminClient, type AdminClientDetail, type AdminPlatform } from "../../lib/admin-clients-api";
import { getAdminTransactionsPage } from "../../lib/admin-recharges-api";
import type { TransactionListItem } from "../../lib/recharges-api";
import styles from "./client-detail-modal.module.css";

type Props = { client: AdminClient | null; onClose: () => void };
const platformOrder: AdminPlatform[] = ["META", "GOOGLE", "TIKTOK"];
/* Logo de cada plataforma en su disco blanco, como en las pastillas de
   filtro: sobre el color pleno de marca se lee la marca, no solo el color. */
const platformLogos: Record<AdminPlatform, { src: string; width: number; height: number }> = {
  META: { src: "/figma/meta.svg", width: 16, height: 11 },
  GOOGLE: { src: "/figma/google.svg", width: 13, height: 14 },
  TIKTOK: { src: "/figma/tiktok.svg", width: 12, height: 14 },
};

/* Pagos que siguen abiertos: ni pagados ni rechazados. */
const OPEN_PAYMENTS = ["PENDING", "IN_CREDIT", "OVERDUE", "UNDER_REVIEW"];

/* Meses de historia desde la primera recarga hasta hoy, ambos incluidos. */
function monthsSince(first: string) {
  const start = new Date(first); const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth() + 1;
}

function cycleStep(item?: TransactionListItem) { if (!item) return 0; if (item.rechargeStatus === "COMPLETED") return 4; if (item.rechargeStatus === "PROCESSING") return 3; if (item.rechargeStatus === "APPROVED") return 2; return 1; }

export default function ClientDetailModal({ client, onClose }: Props) {
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]); const [detail, setDetail] = useState<AdminClientDetail | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { if (!client) return; let active = true; Promise.all([getAdminTransactionsPage({ clientId: client.id, limit: 100 }), getAdminClientDetail(client.id)]).then(([page, data]) => { if (active) { setTransactions(page.items); setDetail(data); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar las transacciones"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [client]);
  const summary = useMemo(() => {
    /* Las recargas rechazadas no son inversión: no cuentan en el total, el
       promedio ni las operaciones por plataforma. */
    const valid = transactions.filter((item) => item.rechargeStatus !== "REJECTED");
    const total = valid.reduce((sum, item) => sum + item.pautaAmount, 0);
    /* El promedio mensual solo dice algo con al menos dos meses de historia:
       con uno repite el total. Se divide por los meses transcurridos desde la
       primera recarga, no solo por los meses con actividad. */
    const first = valid.at(-1)?.createdAt;
    const months = first ? monthsSince(first) : 0;
    const appearances = Object.fromEntries(platformOrder.map((platform) => [platform, valid.filter((item) => item.platforms.includes(platform)).length])) as Record<AdminPlatform, number>;
    /* Participación en dinero solicitado (viene del backend por plataforma),
       no en cuántas recargas incluyen la plataforma. */
    const requested = Object.fromEntries(platformOrder.map((platform) => [platform, detail?.platformSummary?.find((item) => item.platform === platform)?.requested ?? 0])) as Record<AdminPlatform, number>;
    const requestedTotal = Object.values(requested).reduce((sum, value) => sum + value, 0);
    /* Vencimiento: el pago abierto más antiguo, no el de la última recarga. */
    const dueDates = valid.filter((item) => item.paymentStatus && OPEN_PAYMENTS.includes(item.paymentStatus) && item.dueDate).map((item) => item.dueDate!).sort();
    const nextDue = dueDates[0] ?? null;
    return { total, average: months >= 2 ? total / months : null, appearances, requested, requestedTotal, nextDue, overdue: nextDue ? daysUntil(nextDue) < 0 : false };
  }, [transactions, detail]);
  if (!client) return null;
  const latest = transactions[0]; const currentStep = cycleStep(latest); const pending = loading ? "consultando…" : "—";
  return <ModalShell open labelledBy="client-detail-title" className={styles.modal} onClose={onClose}>
    <header className={styles.summary}><div className={styles.identity}><span className={styles.accountBadge}>cliente <b>{client.account.type === "POSTPAGO" ? "post" : "pre"}</b>pago</span><h2 id="client-detail-title">{client.name}</h2><div className={styles.platforms}>{client.account.platforms.map((platform) => <PlatformPill key={platform} platform={platform.toLowerCase() as AdvertisingPlatform} />)}</div></div><div className={styles.metrics}><MetricCard className={styles.metric} label="días de crédito">{client.account.type === "POSTPAGO" ? `${client.account.creditDays} días` : "no aplica"}</MetricCard><MetricCard className={styles.metric} label={summary.overdue ? "vencido desde" : "próximo vencimiento"} tone={summary.overdue ? "danger" : "default"}>{summary.nextDue ? formatDay(summary.nextDue) : pending}</MetricCard><MetricCard className={styles.metric} label="operaciones">{transactions.length}</MetricCard><MetricCard className={styles.metric} label="inversión" tone="success">{formatAmount(summary.total)}</MetricCard></div></header>
    <section className={styles.consumptionSummary} aria-label="Resumen de consumo"><div><small>consumo promedio mensual</small><strong>{loading ? pending : summary.average === null ? "sin histórico" : formatAmount(summary.average)}</strong></div><div><small>última recarga</small><strong>{loading ? pending : latest ? formatAmount(latest.pautaAmount) : "—"}</strong></div><div className={styles.platformTotals}>{platformOrder.map((platform) => <div key={platform} data-platform={platform.toLowerCase()}><span className={styles.platformLogo} aria-hidden="true"><Image src={platformLogos[platform].src} alt="" width={platformLogos[platform].width} height={platformLogos[platform].height} /></span><strong>{summary.appearances[platform]}</strong><small>operaciones con {platform.toLowerCase()}</small></div>)}</div></section>
    <div className={styles.detailGrid}><section className={`${styles.panel} ${styles.cyclePanel}`}><h3>Ciclo más reciente</h3>{latest ? <ol className={styles.cycle}>{["solicitada", "aprobada", "en proceso", "completada"].map((step, index) => <li key={step} data-active={index < currentStep}><span>{index + 1}</span><div><strong>{step}</strong>{index === 0 && <small>{formatDateTime(latest.createdAt)}</small>}</div></li>)}<li className={styles.payment}><small>estado del pago</small><strong>{paymentStatusLabel(latest.paymentStatus)}</strong></li></ol> : <p className={styles.empty}>Este cliente todavía no registra recargas.</p>}</section>
      <section className={styles.panel}><h3>Transacciones</h3><div className={styles.transactions} aria-live="polite" aria-busy={loading}>{transactions.slice(0, 4).map((item) => <div key={item.id} className={styles.transaction}><span title={item.code}>{item.code}</span><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time><strong>+{formatAmount(item.pautaAmount)}</strong><em data-status={item.rechargeStatus}>{rechargeStatusLabel(item.rechargeStatus)}</em></div>)}{loading && <p className={styles.empty}>Consultando transacciones…</p>}{!loading && error && <p className={styles.error} role="alert">{error}</p>}{!loading && !error && !transactions.length && <p className={styles.empty}>Sin transacciones registradas.</p>}</div></section>
      <section className={styles.panel}><h3>Participación por plataforma</h3><div className={styles.habits}>{platformOrder.map((platform) => { const percentage = summary.requestedTotal ? Math.round(summary.requested[platform] / summary.requestedTotal * 100) : 0; return <div key={platform} className={styles.habit}><div><span>{platform.toLowerCase()}</span><strong>{loading ? "—" : `${percentage}%`}</strong></div><div className={styles.track}><span data-platform={platform.toLowerCase()} style={{ transform: `scaleX(${loading ? 0 : percentage / 100})` }} /></div></div>; })}</div></section>
    </div>
  </ModalShell>;
}
