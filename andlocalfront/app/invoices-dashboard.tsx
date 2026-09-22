"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, RotateCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import AccountShell from "./account-shell";
import DateCell from "./components/date-cell";
import InvoiceDetailModal from "./components/invoice-detail-modal";
import PlatformPill from "./components/platform-pill";
import StatusPill from "./components/status-pill";
import type { AccountType, AdvertisingPlatform } from "./design-system/types";
import { getAccessToken, refreshSession } from "./lib/auth-api";
import { accountContext, getMyTransactionDetail, getMyTransactions, transactionsRealtimeUrl, type ClientTransactionDetail, type TransactionListItem } from "./lib/recharges-api";
import { dueLabel, formatAmount, formatClock, formatDateTime } from "./lib/format";
import { paymentStatusLabel, rechargeStatusLabel } from "./lib/status-labels";
import type { VerificationRealtimeEvent } from "./lib/transaction-realtime";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import styles from "./invoices-dashboard.module.css";
import { paymentStatusTone, rechargeStatusTone } from "./lib/status-tone";

const formatDate = formatDateTime;
/** Traduce el fallo a algo accionable: el texto crudo del navegador no ayuda. */
function describeError(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : "";
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return "No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";
  }
  return raw;
}
const PAGE_SIZE = 20;

export default function InvoicesDashboard({ accountType }: { accountType: AccountType }) {
  const revision = usePlatformUpdates();
  const { clientId, accountId } = accountContext(accountType === "prepago" ? "prepago" : "flex");
  const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState(""); const [search, setSearch] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInfo, setPageInfo] = useState({ totalItems: 0, totalPages: 1 });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  /* La búsqueda y las fechas van al servidor: filtrar solo lo cargado ponía un
     techo invisible de 50 transacciones. */
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
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

  const filters = useMemo(() => ({ page: pageNumber, limit: PAGE_SIZE, search: search || undefined, from: fromDate || undefined, to: toDate || undefined }), [pageNumber, search, fromDate, toDate]);
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  useEffect(() => { let active = true; getMyTransactions(filters).then((page) => { if (active) { setTransactions(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); setUpdatedAt(new Date()); setError(""); } }).catch((reason: unknown) => { if (active) setError(describeError(reason)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision, reloads, filters]);
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
        void getMyTransactions(filtersRef.current).then((page) => { if (active) { setTransactions(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); } }).catch(() => undefined);
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
        void getMyTransactions(filtersRef.current).then((page) => { if (active) { setTransactions(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); } }).catch(() => undefined);
        if (detailRef.current?.id === event.transactionId) {
          void getMyTransactionDetail(clientId, event.transactionId).then((transaction) => { if (active) setDetail((current) => current?.id === event.transactionId ? transaction : current); }).catch(() => undefined);
        }
      });
    }

    void connect();
    return () => { active = false; socket?.disconnect(); };
  }, [accountId, clientId]);
  // Ofrecer solo lo que el cliente tiene: filtrar por una plataforma sin
  // recargas solo produce un vacio sin explicacion.
  const availablePlatforms = useMemo(() => {
    const present = new Set(transactions.flatMap((item) => item.platforms.map((value) => value.toLowerCase())));
    return (["meta", "google", "tiktok"] as const).filter((item) => present.has(item));
  }, [transactions]);
  const hasFilters = Boolean(query.trim() || fromDate || toDate || platform);
  function clearFilters() { setFromDate(""); setToDate(""); setPlatform(null); setQuery(""); setPageNumber(1); }
  const visible = useMemo(() => transactions.filter((item) => !platform || item.platforms.includes(platform.toUpperCase() as TransactionListItem["platforms"][number])), [platform, transactions]);
  const rangeLabel = useMemo(() => {
    if (!pageInfo.totalItems) return "0 recargas";
    const first = (pageNumber - 1) * PAGE_SIZE + 1;
    return `${first}-${Math.min(first + transactions.length - 1, pageInfo.totalItems)} de ${pageInfo.totalItems}`;
  }, [pageInfo.totalItems, pageNumber, transactions.length]);
  /* Cualquier cambio de filtro vuelve a la primera página. */
  function changeQuery(value: string) { setQuery(value); setPageNumber(1); }
  function changeFrom(value: string) { setFromDate(value); setPageNumber(1); }
  function changeTo(value: string) { setToDate(value); setPageNumber(1); }

  async function openDetail(id: string) { setDetailLoading(true); setError(""); try { setDetail(await getMyTransactionDetail(clientId, id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar el detalle"); } finally { setDetailLoading(false); } }

  return <AccountShell accountType={accountType} activePage="invoices" contentSize="wide"><>
    <section className={styles.invoiceModule} aria-labelledby="transactions-heading">
      <h1 id="transactions-heading" className={styles.srOnly}>Mis transacciones</h1>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Buscar por código" /></label>
        <div className={styles.filters}>
          {/* Un rango, no dos campos sueltos: el guion dice lo que decían «desde» y
              «hasta», que costaban 90px de los 117 que sobraban. Los nombres siguen
              existiendo para quien navega con lector de pantalla. */}
          <fieldset className={styles.filterGroup}><legend>fecha</legend>
            <input type="date" aria-label="Desde" value={fromDate} onChange={(event) => changeFrom(event.target.value)} />
            <span className={styles.rangeDash} aria-hidden="true">–</span>
            <input type="date" aria-label="Hasta" value={toDate} onChange={(event) => changeTo(event.target.value)} />
          </fieldset>
          {availablePlatforms.length > 0 && <fieldset className={styles.filterGroup}><legend>plataforma</legend>{availablePlatforms.map((item) => <button key={item} type="button" className={styles.platformFilter} aria-pressed={platform === item} onClick={() => setPlatform((current) => current === item ? null : item)}><PlatformPill platform={item} size="filter" active={platform === item} /></button>)}</fieldset>}
        </div>
      </div>
      <div className={styles.listMeta}>
        <span className={styles.metaRange}>{rangeLabel}{hasFilters && <button type="button" className={styles.clearFilters} onClick={clearFilters}>limpiar filtros</button>}</span>
        <span>{updatedAt ? `actualizado a las ${formatClock(updatedAt)}` : "consultando…"}</span>
      </div>
      <div className={styles.invoiceList} aria-live="polite" aria-busy={loading || detailLoading}>
        {visible.map((item) => <article key={item.id} className={styles.invoiceRow}>
          <DateCell value={item.createdAt} />
          <div className={`${styles.cell} ${styles.codeCell}`}><strong><Image src="/figma/money.svg" alt="" width={16} height={16} /> código</strong>
            <button type="button" className={styles.copyCode} title={item.code} onClick={() => void copyCode(item.code)}>
              <span>{item.code}</span><small>{copiedCode === item.code ? "copiado" : "copiar"}</small>
            </button>
          </div>
          <div className={styles.cell}><strong>inversión / total</strong><span className={styles.amount}>{formatAmount(item.pautaAmount)}</span><span className={styles.totalDue}>a pagar {formatAmount(item.totalAmount)}</span></div>
          <div className={styles.cell}><strong>recarga / pago</strong><div className={styles.statuses}><StatusPill tone={rechargeStatusTone(item.rechargeStatus)}>{rechargeStatusLabel(item.rechargeStatus)}</StatusPill>{Boolean(item.pausedDetails) && <StatusPill tone="neutral">{`${item.pausedDetails} en stop`}</StatusPill>}<StatusPill tone={paymentStatusTone(item.paymentStatus)}>{paymentStatusLabel(item.paymentStatus)}</StatusPill></div>
            {item.dueDate && (item.paymentStatus === "IN_CREDIT" || item.paymentStatus === "OVERDUE") &&
              <span className={`${styles.dueDate} ${item.paymentStatus === "OVERDUE" ? styles.dueOverdue : ""}`}>{dueLabel(item.dueDate)}</span>}
          </div>
          <div className={styles.platforms} aria-label="Plataformas">{item.platforms.map((value) => <PlatformPill key={value} platform={value.toLowerCase() as AdvertisingPlatform} size="compact" />)}</div>
          <button type="button" className={styles.detailsLink} aria-haspopup="dialog" disabled={detailLoading} onClick={() => void openDetail(item.id)}>ver detalles</button>
        </article>)}
        {loading && <p className={styles.emptyState}>Cargando transacciones…</p>}
        {!loading && error && <div className={`${styles.emptyState} ${styles.errorState}`} role="alert">
          <p><strong>No pudimos cargar tus recargas</strong></p>
          <p>{error}</p>
          <button type="button" className={styles.retry} onClick={() => setReloads((value) => value + 1)}><RotateCw size={16} aria-hidden="true" />reintentar</button>
        </div>}
        {!loading && !error && visible.length === 0 && (
          transactions.length === 0
            ? <div className={styles.emptyState}>
                <p><strong>Aún no tienes recargas</strong></p>
                <p>Cuando hagas tu primera recarga aparecerá aquí, con su factura y su estado de pago.</p>
                <Link className={styles.emptyAction} href={`/${accountType}`}>hacer una recarga</Link>
              </div>
            : <div className={styles.emptyState}>
                <p><strong>Ninguna recarga coincide con estos filtros</strong></p>
                <p>Tienes {transactions.length} {transactions.length === 1 ? "recarga registrada" : "recargas registradas"}.</p>
                <button type="button" className={styles.emptyAction} onClick={clearFilters}>limpiar filtros</button>
              </div>
        )}
      </div>

      {pageInfo.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de recargas">
        <button type="button" disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><ChevronLeft size={16} aria-hidden="true" />anterior</button>
        <span aria-live="polite">página {pageNumber} de {pageInfo.totalPages}</span>
        <button type="button" disabled={pageNumber >= pageInfo.totalPages || loading} onClick={() => setPageNumber((value) => Math.min(pageInfo.totalPages, value + 1))}>siguiente<ChevronRight size={16} aria-hidden="true" /></button>
      </nav>}
    </section>
    <InvoiceDetailModal accountType={accountType} transaction={detail} onClose={() => setDetail(null)} onReceiptUploaded={() => { setDetail(null); setReloads((value) => value + 1); }} />
  </></AccountShell>;
}
