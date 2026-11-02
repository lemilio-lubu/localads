"use client";

import { Check, CircleAlert, Layers, UserMinus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ToggleChip from "../../components/atoms/toggle-chip";
import SegmentedFilter, { type SegmentOption } from "../../components/molecules/segmented-filter";
import { getAccessToken, getCurrentUser, refreshSession } from "../../lib/auth-api";
import {
  approveVerification,
  getAdminTransactionDetail,
  getAdminVerifications,
  markVerificationUnderReview,
  retryReceiptOcr,
  type PendingVerification,
} from "../../lib/admin-recharges-api";
import { formatClock } from "../../lib/format";
import { transactionsRealtimeUrl } from "../../lib/recharges-api";
import type { VerificationRealtimeEvent } from "../../lib/transaction-realtime";
import VerificationRow from "../../features/verifications/verification-row";
import VerificationReviewModal, { type VerificationSelection } from "../../features/verifications/verification-review-modal";
import styles from "./verifications-dashboard.module.css";
import SearchField from "../../components/molecules/search-field";
import Pagination from "../../components/molecules/pagination";
import LoadError from "../../components/molecules/load-error";

type VerificationFilter = "ALL" | "APPROVED" | "REVIEW";

const PAGE_SIZE = 20;

/* El ámbito es excluyente: mismo control segmentado que Clientes y
   Transacciones, en vez de una píldora propia de 28px con texto de 10px. */
const scopeSegments: SegmentOption<VerificationFilter>[] = [
  { value: "ALL", label: "todos", Icon: Layers, tone: "neutral" },
  { value: "REVIEW", label: "en revisión", Icon: CircleAlert, tone: "amber" },
  { value: "APPROVED", label: "aprobada", Icon: Check, tone: "brand" },
];

function fetchVerifications(filter: VerificationFilter, search: string, pageNumber: number, unassignedOnly = false) {
  return getAdminVerifications({ page: pageNumber, limit: PAGE_SIZE, scope: filter, search: search.trim() || undefined, owner: unassignedOnly ? "unassigned" : undefined });
}

export default function VerificationsDashboard() {
  const [items, setItems] = useState<PendingVerification[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VerificationFilter>("REVIEW");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInfo, setPageInfo] = useState({ totalItems: 0, totalPages: 1 });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [copied, setCopied] = useState<{ code: string; ok: boolean } | null>(null);
  /* El cubo de los que no tienen gestor. Solo se le ofrece al admin: un
     gestor que lo pidiera no obtendria huerfanos ajenos sino nada, porque
     su recorte y este filtro condicionan el mismo campo. */
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  const pageRef = useRef(pageNumber);
  /* El refresco por tiempo real lee de refs; sin esta, un evento devolvia
     la lista sin filtro y el cubo se vaciaba solo. */
  const unassignedRef = useRef(unassignedOnly);
  const [selected, setSelected] = useState<VerificationSelection | null>(null);
  const selectedRef = useRef(selected);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    filterRef.current = filter;
    searchRef.current = search;
    pageRef.current = pageNumber;
    unassignedRef.current = unassignedOnly;
  }, [search, filter, pageNumber, unassignedOnly]);

  /* La búsqueda va al servidor: se espera a que el administrador deje de
     escribir en vez de pedir una consulta por pulsación. */
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let active = true;
    fetchVerifications(filter, search, pageNumber, unassignedOnly).then((page) => {
      if (active) { setError(""); setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); setUpdatedAt(new Date()); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las verificaciones");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, filter, pageNumber, reloadToken, unassignedOnly]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    const socket = io(transactionsRealtimeUrl, { auth: { accessToken }, transports: ["websocket"] });
    socket.on("connect", () => {
      socket.emit("transactions:subscribe", { scope: "admin" });
      void fetchVerifications(filterRef.current, searchRef.current, pageRef.current, unassignedRef.current).then((page) => { setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); }).catch(() => undefined);
    });
    socket.io.on("reconnect_attempt", () => { socket.auth = { accessToken: getAccessToken() }; });
    socket.on("connect_error", () => {
      void refreshSession().then((user) => {
        if (!user) return;
        socket.auth = { accessToken: getAccessToken() };
        socket.connect();
      });
    });
    socket.on("verification:changed", (event: VerificationRealtimeEvent) => {
      setItems((current) => current.map((item) => item.id === event.verificationId ? { ...item, status: event.status, reviewReason: event.reason } : item));
      setSelected((current) => current?.detail.id === event.verificationId ? {
        ...current,
        item: { ...current.item, status: event.status, reviewReason: event.reason },
        detail: { ...current.detail, status: event.status, reviewReason: event.reason, updatedAt: event.occurredAt },
      } : current);
      void fetchVerifications(filterRef.current, searchRef.current, pageRef.current, unassignedRef.current).then((page) => { setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); }).catch(() => undefined);
      if (selectedRef.current?.detail.id === event.verificationId) {
        void getAdminTransactionDetail(event.transactionId).then((transaction) => {
          const detail = transaction.verifications.find((verification) => verification.id === event.verificationId);
          if (!detail) return;
          setSelected((current) => current?.detail.id === event.verificationId ? { ...current, detail } : current);
        }).catch(() => undefined);
      }
    });
    return () => { socket.disconnect(); };
  }, []);

  async function open(item: PendingVerification) {
    setBusy(true);
    setError("");
    try {
      const transaction = await getAdminTransactionDetail(item.transactionId);
      const detail = transaction.verifications.find((verification) => verification.id === item.id);
      if (!detail) throw new Error("La verificación ya no está disponible");
      setSelected({ item, detail });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar la verificación");
    } finally { setBusy(false); }
  }

  /* Devuelve si se resolvió: la revisión cierra su formulario del motivo solo entonces. */
  async function decide(action: "approve" | "review", reason = ""): Promise<boolean> {
    if (!selected || (action === "review" && !reason.trim())) return false;
    const current = selected;
    setBusy(true);
    setError("");
    try {
      if (action === "approve") await approveVerification(current.detail.id);
      else await markVerificationUnderReview(current.detail.id, reason);
      const [page, transaction] = await Promise.all([
        fetchVerifications(filter, search, pageNumber, unassignedOnly),
        getAdminTransactionDetail(current.item.transactionId),
      ]);
      setItems(page.items);
      setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages });
      const detail = transaction.verifications.find((verification) => verification.id === current.detail.id);
      if (detail) setSelected((value) => value?.detail.id === detail.id ? { ...value, detail } : value);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible resolver la verificación");
      return false;
    } finally { setBusy(false); }
  }

  async function retryOcr() {
    if (!selected) return;
    const current = selected;
    setBusy(true);
    setError("");
    try {
      await retryReceiptOcr(current.detail.receipt.id);
      const [page, transaction] = await Promise.all([
        fetchVerifications(filter, search, pageNumber, unassignedOnly),
        getAdminTransactionDetail(current.item.transactionId),
      ]);
      setItems(page.items);
      setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages });
      /* La lectura nueva crea otra verificación para el mismo comprobante. */
      const detail = transaction.verifications.find((verification) => verification.receipt.id === current.detail.receipt.id);
      if (detail) setSelected((value) => value ? { item: { ...value.item, id: detail.id }, detail } : value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible repetir la lectura del comprobante");
    } finally { setBusy(false); }
  }

  /* Cambiar de filtro o de búsqueda vuelve a la primera página: quedarse en la
     tercera de un resultado que ahora tiene una sola muestra una lista vacía. */
  function selectFilter(value: VerificationFilter) {
    if (value === filter) return;
    setLoading(true); setError(""); setFilter(value); setPageNumber(1);
  }
  function changeQuery(value: string) { setQuery(value); setPageNumber(1); }
  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  const rangeLabel = useMemo(() => {
    if (!pageInfo.totalItems) return "0 verificaciones";
    const first = (pageNumber - 1) * PAGE_SIZE + 1;
    return `${first}-${Math.min(first + items.length - 1, pageInfo.totalItems)} de ${pageInfo.totalItems}`;
  }, [items.length, pageInfo.totalItems, pageNumber]);

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

  return <div className={styles.module}>
    <header className={styles.toolbar}>
      <SearchField value={query} onChange={changeQuery} placeholder="Buscar por cliente, código o banco" placeholderTone="muted" className={styles.search} />
      <div className={styles.filters}><div className={styles.filterGroup}><span>estado</span>
        <SegmentedFilter label="Estado de la verificación" options={scopeSegments} value={filter} onChange={selectFilter} />
      </div>{isAdmin && <div className={styles.filterGroup}><span>gestor</span><ToggleChip className={styles.managerFilter} pressed={unassignedOnly} onClick={() => setUnassignedOnly((current) => !current)}><UserMinus size={15} aria-hidden="true" />sin asignar</ToggleChip></div>}</div>
    </header>

    <div className={styles.listMeta}><span>{rangeLabel}</span><span>{updatedAt ? `actualizado a las ${formatClock(updatedAt)}` : "consultando…"}</span></div>

    <div className={styles.list} aria-live="polite" aria-busy={loading || busy}>
      {!loading && !error && items.map((item) => <VerificationRow key={item.id} item={item} copyState={copied?.code === item.transactionCode ? (copied.ok ? "done" : "failed") : undefined} copyLabel={copyLabel(item.transactionCode)} busy={busy} onCopy={(element) => void copyCode(item.transactionCode, element)} onOpen={() => void open(item)} />)}
      {loading && <><div className={styles.skeleton} /><div className={styles.skeleton} /></>}
      {!loading && error && <LoadError title="No se pudieron cargar las verificaciones" message={error} frame="control" onRetry={retry} />}
      {!loading && !error && !items.length && <p className={styles.message}>No hay verificaciones para este filtro.</p>}
    </div>

    <Pagination page={pageNumber} totalPages={pageInfo.totalPages} disabled={loading} label="Paginación de verificaciones" onChange={setPageNumber} />

    <VerificationReviewModal selected={selected} busy={busy} error={error} onClose={() => setSelected(null)} onApprove={() => void decide("approve")} onReview={(reason) => decide("review", reason)} onRetryOcr={() => void retryOcr()} />
  </div>;
}
