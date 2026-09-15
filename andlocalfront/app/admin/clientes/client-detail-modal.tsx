"use client";

import { useEffect, useMemo, useState } from "react";
import MetricCard from "../../components/metric-card";
import ModalShell from "../../components/modal-shell";
import PlatformPill from "../../components/platform-pill";
import type { AdvertisingPlatform } from "../../design-system/types";
import type { AdminClient, AdminPlatform } from "../../lib/admin-clients-api";
import { getAdminTransactionsPage } from "../../lib/admin-recharges-api";
import type { TransactionListItem } from "../../lib/recharges-api";
import styles from "./client-detail-modal.module.css";

type Props = { client: AdminClient | null; onClose: () => void };
const platformOrder: AdminPlatform[] = ["META", "GOOGLE", "TIKTOK"];
const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const label = (value: string | null) => value ? value.toLowerCase().replaceAll("_", " ") : "—";
function cycleStep(item?: TransactionListItem) { if (!item) return 0; if (item.rechargeStatus === "COMPLETED") return 4; if (item.rechargeStatus === "PROCESSING") return 3; if (item.rechargeStatus === "APPROVED") return 2; return 1; }

export default function ClientDetailModal({ client, onClose }: Props) {
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { if (!client) return; let active = true; getAdminTransactionsPage({ clientId: client.id, limit: 100 }).then((page) => { if (active) setTransactions(page.items); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar las transacciones"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [client]);
  const summary = useMemo(() => { const total = transactions.reduce((sum, item) => sum + item.pautaAmount, 0); const months = new Set(transactions.map((item) => item.createdAt.slice(0, 7))).size || 1; const appearances = Object.fromEntries(platformOrder.map((platform) => [platform, transactions.filter((item) => item.platforms.includes(platform)).length])) as Record<AdminPlatform, number>; const totalAppearances = Object.values(appearances).reduce((sum, value) => sum + value, 0); return { total, average: transactions.length ? total / months : 0, appearances, totalAppearances }; }, [transactions]);
  if (!client) return null;
  const latest = transactions[0]; const currentStep = cycleStep(latest); const pending = loading ? "consultando…" : "—";
  return <ModalShell open labelledBy="client-detail-title" className={styles.modal} onClose={onClose}>
    <header className={styles.summary}><div className={styles.identity}><span className={styles.accountBadge}>cliente <b>{client.account.type === "POSTPAGO" ? "post" : "pre"}</b>pago</span><h2 id="client-detail-title">{client.name}</h2><div className={styles.platforms}>{client.account.platforms.map((platform) => <PlatformPill key={platform} platform={platform.toLowerCase() as AdvertisingPlatform} />)}</div></div><div className={styles.metrics}><MetricCard className={styles.metric} label="días de crédito">{client.account.type === "POSTPAGO" ? `${client.account.creditDays} días` : "no aplica"}</MetricCard><MetricCard className={styles.metric} label="próximo vencimiento">{latest?.dueDate ? date(latest.dueDate) : pending}</MetricCard><MetricCard className={styles.metric} label="operaciones">{transactions.length}</MetricCard><MetricCard className={styles.metric} label="inversión" tone="success">{money(summary.total)}</MetricCard></div></header>
    <section className={styles.consumptionSummary} aria-label="Resumen de consumo"><div><small>consumo promedio mensual</small><strong>{loading ? pending : money(summary.average)}</strong></div><div><small>última recarga</small><strong>{loading ? pending : latest ? money(latest.pautaAmount) : "—"}</strong></div><div className={styles.platformTotals}>{platformOrder.map((platform) => <div key={platform} data-platform={platform.toLowerCase()}><strong>{summary.appearances[platform]}</strong><small>operaciones con {platform.toLowerCase()}</small></div>)}</div></section>
    <div className={styles.detailGrid}><section className={`${styles.panel} ${styles.cyclePanel}`}><h3>Ciclo más reciente</h3>{latest ? <ol className={styles.cycle}>{["solicitada", "aprobada", "en proceso", "completada"].map((step, index) => <li key={step} data-active={index < currentStep}><span>{index + 1}</span><div><strong>{step}</strong>{index === 0 && <small>{date(latest.createdAt)}</small>}</div></li>)}<li className={styles.payment}><small>estado del pago</small><strong>{label(latest.paymentStatus)}</strong></li></ol> : <p className={styles.empty}>Este cliente todavía no registra recargas.</p>}</section>
      <section className={styles.panel}><h3>Transacciones</h3><div className={styles.transactions} aria-live="polite" aria-busy={loading}>{transactions.slice(0, 4).map((item) => <div key={item.id} className={styles.transaction}><span title={item.code}>{item.code}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time><strong>+{money(item.pautaAmount)}</strong><em data-status={item.rechargeStatus}>{label(item.rechargeStatus)}</em></div>)}{loading && <p className={styles.empty}>Consultando transacciones…</p>}{!loading && error && <p className={styles.error} role="alert">{error}</p>}{!loading && !error && !transactions.length && <p className={styles.empty}>Sin transacciones registradas.</p>}</div></section>
      <section className={styles.panel}><h3>Participación por plataforma</h3><div className={styles.habits}>{platformOrder.map((platform) => { const percentage = summary.totalAppearances ? Math.round(summary.appearances[platform] / summary.totalAppearances * 100) : 0; return <div key={platform} className={styles.habit}><div><span>{platform.toLowerCase()}</span><strong>{loading ? "—" : `${percentage}%`}</strong></div><div className={styles.track}><span data-platform={platform.toLowerCase()} style={{ transform: `scaleX(${loading ? 0 : percentage / 100})` }} /></div></div>; })}</div></section>
    </div>
  </ModalShell>;
}
