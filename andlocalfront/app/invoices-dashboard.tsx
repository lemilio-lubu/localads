"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import AccountShell from "./account-shell";
import InvoiceDetailModal from "./components/invoice-detail-modal";
import PlatformPill from "./components/platform-pill";
import StatusPill from "./components/status-pill";
import type { AccountType, AdvertisingPlatform } from "./design-system/types";
import { getAccessToken, refreshSession } from "./lib/auth-api";
import { accountContext, getMyTransactionDetail, getMyTransactions, transactionsRealtimeUrl, type ClientTransactionDetail, type TransactionListItem } from "./lib/recharges-api";
import { paymentStatusLabel, rechargeStatusLabel } from "./lib/status-labels";
import type { VerificationRealtimeEvent } from "./lib/transaction-realtime";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import styles from "./invoices-dashboard.module.css";

const formatDate = (value: string) => new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const formatAmount = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
/** Traduce el fallo a algo accionable: el texto crudo del navegador no ayuda. */
function describeError(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : "";
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return "No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
  }
  return raw;
}
const formatDay = (value: string) => new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
/** Dias entre hoy y el vencimiento, contados por dia natural para que "vence hoy" sea hoy. */
function daysUntil(value: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(value); end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
function dueLabel(dueDate: string) {
  const days = daysUntil(dueDate);
  if (days > 1) return `vence en ${days} días · ${formatDay(dueDate)}`;
  if (days === 1) return `vence mañana · ${formatDay(dueDate)}`;
  if (days === 0) return `vence hoy · ${formatDay(dueDate)}`;
  const overdue = Math.abs(days);
  return `venció hace ${overdue} ${overdue === 1 ? "día" : "días"} · ${formatDay(dueDate)}`;
}
const statusTone = (value: string | null): "success" | "danger" | "neutral" => value && ["PAID", "COMPLETED", "APPROVED", "IN_CREDIT"].includes(value) ? "success" : value && ["REJECTED", "OVERDUE"].includes(value) ? "danger" : "neutral";

export default function InvoicesDashboard({ accountType }: { accountType: AccountType }) {
  const revision = usePlatformUpdates();
  const { clientId, accountId } = accountContext(accountType === "prepago" ? "prepago" : "flex");
  const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [copiedCode, setCopiedCode] = useState("");
  const [reloads, setReloads] = useState(0);
  const [platform, setPlatform] = useState<AdvertisingPlatform | null>(null);
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [detail, setDetail] = useState<ClientTransactionDetail | null>(null);
  const detailRef = useRef(detail);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState("");

  useEffect(() => { detailRef.current = detail; }, [detail]);
  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => (current === code ? "" : current)), 2000);
    } catch {
      setCopiedCode("");
    }
  }

  useEffect(() => { let active = true; getMyTransactions(clientId).then((page) => { if (active) { setTransactions(page.items); setError(""); } }).catch((reason: unknown) => { if (active) setError(describeError(reason)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision, reloads]);
  const detailId = detail?.id;
  useEffect(() => { if (!detailId) return; let active = true; getMyTransactionDetail(clientId, detailId).then((next) => { if (active) setDetail(next); }).catch(() => undefined); return () => { active = false; }; }, [clientId, detailId, revision]);

  useEffect(() => {
    let active = true;
    let socket: ReturnType<typeof io> | null = null;
    let refreshing = false;

    async function connect() {
      if (!getAccessToken()) await refreshSession();
      const accessToken = getAccessToken();
      if (!active || !accessToken) return;
      socket = io(transactionsRealtimeUrl, { auth: { accessToken }, transports: ["websocket"] });
      socket.on("connect", () => {
        socket?.emit("transactions:subscribe", { accountId });
        void getMyTransactions(clientId).then((page) => { if (active) setTransactions(page.items); }).catch(() => undefined);
      });
      socket.io.on("reconnect_attempt", () => { if (socket) socket.auth = { accessToken: getAccessToken() }; });
      socket.on("connect_error", () => {
        if (refreshing) return;
        refreshing = true;
        void refreshSession().then((user) => {
          if (active && user && socket) {
            socket.auth = { accessToken: getAccessToken() };
            socket.connect();
          }
        }).finally(() => { refreshing = false; });
      });
      socket.on("verification:changed", (event: VerificationRealtimeEvent) => {
        setTransactions((current) => current.map((item) => item.id === event.transactionId ? { ...item, rechargeStatus: event.rechargeStatus, paymentStatus: event.paymentStatus } : item));
        setDetail((current) => current?.id === event.transactionId ? {
          ...current,
          rechargeStatus: event.rechargeStatus,
          payment: current.payment ? { ...current.payment, status: event.paymentStatus } : null,
          verification: { status: event.status, reviewReason: event.reason, updatedAt: event.occurredAt },
        } : current);
        void getMyTransactions(clientId).then((page) => { if (active) setTransactions(page.items); }).catch(() => undefined);
        if (detailRef.current?.id === event.transactionId) {
          void getMyTransactionDetail(clientId, event.transactionId).then((transaction) => { if (active) setDetail((current) => current?.id === event.transactionId ? transaction : current); }).catch(() => undefined);
        }
      });
    }

    void connect();
    return () => { active = false; socket?.disconnect(); };
  }, [accountId, clientId]);
  const visible = useMemo(() => transactions.filter((item) => { const day = item.createdAt.slice(0, 10); return (!fromDate || day >= fromDate) && (!toDate || day <= toDate) && (!platform || item.platforms.includes(platform.toUpperCase() as TransactionListItem["platforms"][number])); }), [fromDate, platform, toDate, transactions]);

  async function openDetail(id: string) { setDetailLoading(true); setError(""); try { setDetail(await getMyTransactionDetail(clientId, id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar el detalle"); } finally { setDetailLoading(false); } }

  return <AccountShell accountType={accountType} activePage="invoices" contentSize="wide"><>
    <section className={styles.invoiceModule} aria-labelledby="transactions-heading">
      <h1 id="transactions-heading" className={styles.srOnly}>Mis transacciones</h1>
      <div className={styles.filters}>
        <fieldset className={styles.dateFilter}><legend>Filtrar fecha</legend><label><span>desde</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label><label><span>hasta</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label></fieldset>
        <fieldset className={styles.platformFilter}><legend>Filtrar plataforma</legend>{(["meta", "google", "tiktok"] as const).map((item) => <button key={item} type="button" className={`${styles.filterButton} ${styles[item]}`} aria-pressed={platform === item} onClick={() => setPlatform((current) => current === item ? null : item)}><PlatformPill platform={item} /></button>)}</fieldset>
      </div>
      <div className={styles.invoiceList} aria-live="polite" aria-busy={loading || detailLoading}>
        {visible.map((item) => <article key={item.id} className={styles.invoiceRow}>
          <div className={styles.cell}><strong>fecha</strong><span>{formatDate(item.createdAt)}</span></div>
          <div className={`${styles.cell} ${styles.codeCell}`}><strong><Image src="/figma/money.svg" alt="" width={16} height={16} /> código</strong>
            <button type="button" className={styles.copyCode} title={item.code} onClick={() => void copyCode(item.code)}>
              <span>{item.code}</span><small>{copiedCode === item.code ? "copiado" : "copiar"}</small>
            </button>
          </div>
          <div className={styles.cell}><strong>inversión / total</strong><span className={styles.amount}>{formatAmount(item.pautaAmount)}</span><span className={styles.totalDue}>a pagar {formatAmount(item.totalAmount)}</span></div>
          <div className={styles.cell}><strong>recarga / pago</strong><div className={styles.statuses}><StatusPill tone={statusTone(item.rechargeStatus)}>{rechargeStatusLabel(item.rechargeStatus)}</StatusPill>{Boolean(item.pausedDetails) && <StatusPill tone="neutral">{`${item.pausedDetails} en stop`}</StatusPill>}<StatusPill tone={statusTone(item.paymentStatus)}>{paymentStatusLabel(item.paymentStatus)}</StatusPill></div>
            {item.dueDate && (item.paymentStatus === "IN_CREDIT" || item.paymentStatus === "OVERDUE") &&
              <span className={`${styles.dueDate} ${item.paymentStatus === "OVERDUE" ? styles.dueOverdue : ""}`}>{dueLabel(item.dueDate)}</span>}
          </div>
          <div className={styles.platforms} aria-label="Plataformas">{item.platforms.map((value) => <PlatformPill key={value} platform={value.toLowerCase() as AdvertisingPlatform} size="compact" />)}</div>
          <button type="button" className={styles.detailsButton} aria-haspopup="dialog" disabled={detailLoading} onClick={() => void openDetail(item.id)}>ver detalles</button>
        </article>)}
        {loading && <p className={styles.emptyState}>Cargando transacciones…</p>}
        {!loading && error && <p className={styles.emptyState} role="alert">{error}</p>}
        {!loading && !error && visible.length === 0 && <p className={styles.emptyState}>No hay transacciones para los filtros seleccionados.</p>}
      </div>
    </section>
    <InvoiceDetailModal accountType={accountType} transaction={detail} onClose={() => setDetail(null)} onReceiptUploaded={() => { setDetail(null); setReloads((value) => value + 1); }} />
  </></AccountShell>;
}
