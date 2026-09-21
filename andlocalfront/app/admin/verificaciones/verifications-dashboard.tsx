"use client";

import Image from "next/image";
import { Check, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, Layers, RotateCw, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ModalShell from "../../components/modal-shell";
import SegmentedFilter, { type SegmentOption } from "../../components/segmented-filter";
import StatusPill from "../../components/status-pill";
import { authenticatedFetch, getAccessToken, openAuthenticatedFile, refreshSession } from "../../lib/auth-api";
import {
  approveVerification,
  getAdminTransactionDetail,
  getAdminVerifications,
  markVerificationUnderReview,
  type AdminVerification,
  type PendingVerification,
  type VerificationStatus,
} from "../../lib/admin-recharges-api";
import { formatAmount, formatDateTime } from "../../lib/format";
import { resolveApiAssetUrl, transactionsRealtimeUrl } from "../../lib/recharges-api";
import { verificationIssueLabel, verificationStatusLabel } from "../../lib/status-labels";
import type { VerificationRealtimeEvent } from "../../lib/transaction-realtime";
import styles from "./verifications-dashboard.module.css";
import { verificationStatusTone } from "../../lib/status-tone";

type VerificationFilter = "ALL" | "APPROVED" | "REVIEW";

const reviewStatuses: VerificationStatus[] = ["EN_REVISION", "VERIFICADA_AUTOMATICAMENTE"];
const clock = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });
const PAGE_SIZE = 20;

/* El ámbito es excluyente: mismo control segmentado que Clientes y
   Transacciones, en vez de una píldora propia de 28px con texto de 10px. */
const scopeSegments: SegmentOption<VerificationFilter>[] = [
  { value: "ALL", label: "todos", Icon: Layers, tone: "neutral" },
  { value: "REVIEW", label: "en revisión", Icon: CircleAlert, tone: "amber" },
  { value: "APPROVED", label: "aprobada", Icon: Check, tone: "brand" },
];

function fetchVerifications(filter: VerificationFilter, search: string, pageNumber: number) {
  return getAdminVerifications({ page: pageNumber, limit: PAGE_SIZE, scope: filter, search: search.trim() || undefined });
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
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  const pageRef = useRef(pageNumber);
  const [selected, setSelected] = useState<{ item: PendingVerification; detail: AdminVerification } | null>(null);
  const selectedRef = useRef(selected);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    filterRef.current = filter;
    searchRef.current = search;
    pageRef.current = pageNumber;
  }, [search, filter, pageNumber]);

  /* La búsqueda va al servidor: se espera a que el administrador deje de
     escribir en vez de pedir una consulta por pulsación. */
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let active = true;
    fetchVerifications(filter, search, pageNumber).then((page) => {
      if (active) { setError(""); setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); setUpdatedAt(new Date()); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las verificaciones");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, filter, pageNumber, reloadToken]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    const socket = io(transactionsRealtimeUrl, { auth: { accessToken }, transports: ["websocket"] });
    socket.on("connect", () => {
      socket.emit("transactions:subscribe", { scope: "admin" });
      void fetchVerifications(filterRef.current, searchRef.current, pageRef.current).then((page) => { setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); }).catch(() => undefined);
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
      void fetchVerifications(filterRef.current, searchRef.current, pageRef.current).then((page) => { setItems(page.items); setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages }); }).catch(() => undefined);
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

  useEffect(() => {
    if (!selected) return;
    let active = true;
    let objectUrl = "";
    authenticatedFetch(resolveApiAssetUrl(selected.item.receiptContentUrl)).then(async (response) => {
      if (!response.ok) throw new Error("No fue posible cargar el comprobante");
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setPreviewUrl(objectUrl);
    }).catch((cause: unknown) => {
      if (active) setPreviewError(cause instanceof Error ? cause.message : "No fue posible mostrar el comprobante");
    }).finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);

  const hardBlocked = selected?.detail.issues.some((issue) => ["COMPROBANTE_DUPLICADO", "REFERENCIA_BANCARIA_DUPLICADA"].includes(issue)) ?? false;

  async function open(item: PendingVerification) {
    setBusy(true);
    setError("");
    try {
      const transaction = await getAdminTransactionDetail(item.transactionId);
      const detail = transaction.verifications.find((verification) => verification.id === item.id);
      if (!detail) throw new Error("La verificación ya no está disponible");
      setPreviewUrl("");
      setPreviewError("");
      setPreviewLoading(true);
      setSelected({ item, detail });
      setReason("");
      setReviewing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar la verificación");
    } finally { setBusy(false); }
  }

  async function decide(action: "approve" | "review") {
    if (!selected || (action === "review" && !reason.trim())) return;
    const current = selected;
    setBusy(true);
    setError("");
    try {
      if (action === "approve") await approveVerification(current.detail.id);
      else await markVerificationUnderReview(current.detail.id, reason);
      const [page, transaction] = await Promise.all([
        fetchVerifications(filter, search, pageNumber),
        getAdminTransactionDetail(current.item.transactionId),
      ]);
      setItems(page.items);
      setPageInfo({ totalItems: page.totalItems, totalPages: page.totalPages });
      const detail = transaction.verifications.find((verification) => verification.id === current.detail.id);
      if (detail) setSelected((value) => value?.detail.id === detail.id ? { ...value, detail } : value);
      setReviewing(false);
      setReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible resolver la verificación");
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
      <label className={styles.search}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Buscar por cliente, código o banco" /></label>
      <div className={styles.filters}><div className={styles.filterGroup}><span>estado</span>
        <SegmentedFilter label="Estado de la verificación" options={scopeSegments} value={filter} onChange={selectFilter} />
      </div></div>
    </header>

    <div className={styles.listMeta}><span>{rangeLabel}</span><span>{updatedAt ? `actualizado a las ${clock.format(updatedAt)}` : "consultando…"}</span></div>

    <div className={styles.list} aria-live="polite" aria-busy={loading || busy}>
      {!loading && !error && items.map((item) => <article key={item.id} className={styles.row}>
        <span className={styles.transferIcon}><Image src="/figma/admin-transfer.svg" alt="" width={54} height={54} /><small>transf.</small></span>
        <div className={styles.cell}><strong>fecha</strong><span>{formatDateTime(item.createdAt)}</span></div>
        <div className={`${styles.cell} ${styles.codeCell}`}><strong>cliente</strong><span className={styles.clientName}>{item.clientName}</span>
          <button type="button" className={styles.copyCode} data-state={copied?.code === item.transactionCode ? (copied.ok ? "done" : "failed") : undefined} title={item.transactionCode} onClick={(event) => void copyCode(item.transactionCode, event.currentTarget.querySelector("span"))}>
            <span>{item.transactionCode}</span><small>{copyLabel(item.transactionCode)}</small>
          </button>
        </div>
        <div className={styles.cell}><strong>banco de origen</strong><span>{item.bank ?? "No identificado"}</span></div>
        <div className={styles.cell}><strong>a verificar / a recargar</strong><span className={styles.expected}>{formatAmount(item.expectedTransferAmount)}</span><span className={styles.detected}>recarga {formatAmount(item.requestedPautaAmount)}</span></div>
        <div className={styles.cell}><strong>estado</strong><StatusPill tone={verificationStatusTone(item.status)}>{verificationStatusLabel(item.status)}</StatusPill></div>
        <button type="button" className={styles.reviewButton} aria-haspopup="dialog" disabled={busy} onClick={() => void open(item)}>revisar</button>
      </article>)}
      {loading && <><div className={styles.skeleton} /><div className={styles.skeleton} /></>}
      {!loading && error && <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
        <p><strong>No se pudieron cargar las verificaciones</strong></p>
        <p>{error}</p>
        <button type="button" className={styles.retry} onClick={retry}><RotateCw size={16} aria-hidden="true" />reintentar</button>
      </div>}
      {!loading && !error && !items.length && <p className={styles.message}>No hay verificaciones para este filtro.</p>}
    </div>

    {pageInfo.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de verificaciones">
      <button type="button" disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><ChevronLeft size={16} aria-hidden="true" />anterior</button>
      <span aria-live="polite">página {pageNumber} de {pageInfo.totalPages}</span>
      <button type="button" disabled={pageNumber >= pageInfo.totalPages || loading} onClick={() => setPageNumber((value) => Math.min(pageInfo.totalPages, value + 1))}>siguiente<ChevronRight size={16} aria-hidden="true" /></button>
    </nav>}

    <ModalShell open={Boolean(selected)} labelledBy="verification-title" onClose={() => setSelected(null)} className={styles.modal}>{selected && <>
      <header className={styles.modalHeader}><div><small>verificación de transferencia</small><h2 id="verification-title">{selected.item.clientName}</h2><p>{selected.item.transactionCode}</p></div><StatusPill tone={verificationStatusTone(selected.detail.status)}>{verificationStatusLabel(selected.detail.status)}</StatusPill></header>
      <div className={styles.reviewGrid}>
        <section className={styles.previewPanel}>
          <div className={styles.previewHeader}><div><small>evidencia original</small><strong>{selected.detail.receipt.originalName}</strong></div><button type="button" onClick={() => void openAuthenticatedFile(resolveApiAssetUrl(selected.item.receiptContentUrl))}>Abrir <ExternalLink size={15} /></button></div>
          <div className={styles.preview}>
            {previewLoading && <span>Cargando comprobante…</span>}
            {previewError && <span className={styles.previewFailure}><ShieldAlert size={24} />{previewError}</span>}
            {previewUrl && selected.detail.receipt.mimeType === "application/pdf" && <iframe src={previewUrl} title="Comprobante de transferencia" />}
            {previewUrl && selected.detail.receipt.mimeType !== "application/pdf" && <Image src={previewUrl} alt={`Comprobante de ${selected.item.clientName}`} fill unoptimized sizes="(max-width: 1120px) 100vw, 580px" />}
          </div>
        </section>
        <section className={styles.dataPanel}>
          <h3>Datos para validar</h3>
          <dl>
            <div><dt>Valor esperado</dt><dd>{formatAmount(selected.detail.expectedAmount)}</dd></div>
            <div><dt>Valor detectado</dt><dd data-match={selected.detail.amountMatches}>{selected.detail.detectedAmount == null ? "No detectado" : formatAmount(selected.detail.detectedAmount)}</dd></div>
            <div><dt>Banco</dt><dd>{selected.detail.ocr?.bank ?? "No identificado"}</dd></div>
            <div><dt>Código bancario</dt><dd>{selected.detail.ocr?.transactionCode ?? "No identificado"}</dd></div>
            <div><dt>Fecha detectada</dt><dd>{selected.detail.ocr?.detectedDate ?? "No detectada"}</dd></div>
            <div><dt>Confianza OCR</dt><dd>{selected.detail.ocr?.confidence == null ? "—" : `${Math.round(selected.detail.ocr.confidence)}%`}</dd></div>
          </dl>
          {selected.detail.decisionAudit && <div className={styles.audit}>
            <small>decisión registrada</small>
            <strong>{selected.detail.decisionAudit.decision === "APPROVE" ? "Aprobada" : selected.detail.decisionAudit.decision === "REVIEW" ? "En revisión" : "Rechazada"} por {selected.detail.decisionAudit.administratorUserId}</strong>
            <span>{formatDateTime(selected.detail.decisionAudit.createdAt)}</span>
            {(selected.detail.decisionAudit.notes || selected.detail.decisionAudit.reviewReason || selected.detail.decisionAudit.rejectionReason) && <p>{selected.detail.decisionAudit.notes ?? selected.detail.decisionAudit.reviewReason ?? selected.detail.decisionAudit.rejectionReason}</p>}
          </div>}
          {selected.detail.reviewReason && <div className={styles.reviewNotice}>
            <small>Motivo de revisión</small>
            <p>{selected.detail.reviewReason}</p>
            <span>Actualizado {formatDateTime(selected.detail.updatedAt ?? selected.detail.decisionAudit?.createdAt ?? selected.detail.createdAt)}</span>
          </div>}
          {selected.detail.issues.length > 0 && <div className={styles.issues}><strong>Señales de revisión</strong><ul>{selected.detail.issues.map((issue) => <li key={issue}>{verificationIssueLabel(issue)}</li>)}</ul></div>}
          {reviewStatuses.includes(selected.detail.status) && <div className={styles.actions}>{reviewing ? <div className={styles.reviewForm}><label>Motivo de revisión<textarea autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" onClick={() => { setReviewing(false); setReason(""); }}>Cancelar</button><button type="button" disabled={!reason.trim() || busy} onClick={() => void decide("review")}><CircleAlert size={16} />Enviar a revisión</button></div></div> : <><button type="button" disabled={busy} onClick={() => { setReason(selected.detail.reviewReason ?? ""); setReviewing(true); }}><CircleAlert size={17} />En revisión</button><button type="button" disabled={busy || hardBlocked} title={hardBlocked ? "La evidencia duplicada no puede aprobarse" : undefined} onClick={() => void decide("approve")}><Check size={17} />Aprobar transferencia</button></>}</div>}
          {hardBlocked && !reviewing && <p className={styles.error}>La aprobación está bloqueada: el comprobante o código bancario ya fue utilizado.</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </div>
    </>}</ModalShell>
  </div>;
}
