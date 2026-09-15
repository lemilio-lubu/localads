"use client";

import Image from "next/image";
import { Check, CircleAlert, ExternalLink, Search, ShieldAlert } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import ModalShell from "../../components/modal-shell";
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
import { resolveApiAssetUrl, transactionsRealtimeUrl } from "../../lib/recharges-api";
import { verificationIssueLabel, verificationStatusLabel } from "../../lib/status-labels";
import type { VerificationRealtimeEvent } from "../../lib/transaction-realtime";
import styles from "./verifications-dashboard.module.css";

type VerificationFilter = "ALL" | "APPROVED" | "REVIEW";

const money = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const reviewStatuses: VerificationStatus[] = ["EN_REVISION", "VERIFICADA_AUTOMATICAMENTE"];

function statusTone(status: VerificationStatus): "success" | "danger" | "neutral" {
  if (status === "APROBADA") return "success";
  if (status === "RECHAZADA") return "danger";
  return "neutral";
}

async function fetchVerifications(filter: VerificationFilter, search: string) {
  const page = await getAdminVerifications({ limit: 100, scope: filter, search: search.trim() || undefined });
  return page.items;
}

export default function VerificationsDashboard() {
  const [items, setItems] = useState<PendingVerification[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<VerificationFilter>("REVIEW");
  const filterRef = useRef(filter);
  const searchRef = useRef(deferredQuery);
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
    searchRef.current = deferredQuery;
  }, [deferredQuery, filter]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let active = true;
    fetchVerifications(filter, deferredQuery).then((records) => {
      if (active) setItems(records);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "No fue posible consultar las verificaciones");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [deferredQuery, filter]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    const socket = io(transactionsRealtimeUrl, { auth: { accessToken }, transports: ["websocket"] });
    socket.on("connect", () => {
      socket.emit("transactions:subscribe", { scope: "admin" });
      void fetchVerifications(filterRef.current, searchRef.current).then(setItems).catch(() => undefined);
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
      void fetchVerifications(filterRef.current, searchRef.current).then(setItems).catch(() => undefined);
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
      const [records, transaction] = await Promise.all([
        fetchVerifications(filter, deferredQuery),
        getAdminTransactionDetail(current.item.transactionId),
      ]);
      setItems(records);
      const detail = transaction.verifications.find((verification) => verification.id === current.detail.id);
      if (detail) setSelected((value) => value?.detail.id === detail.id ? { ...value, detail } : value);
      setReviewing(false);
      setReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible resolver la verificación");
    } finally { setBusy(false); }
  }

  function selectFilter(value: VerificationFilter) {
    if (value === filter) return;
    setLoading(true);
    setError("");
    setFilter(value);
  }

  return <div className={styles.module}>
    <header className={styles.toolbar}>
      <label className={styles.search}><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Búsqueda por clientes, código o banco" /></label>
      <div className={styles.filters} aria-label="Filtrar verificaciones">
        <button type="button" aria-pressed={filter === "ALL"} onClick={() => selectFilter("ALL")}>todos</button>
        <button type="button" aria-pressed={filter === "APPROVED"} onClick={() => selectFilter("APPROVED")}>aprobado</button>
        <button type="button" aria-pressed={filter === "REVIEW"} onClick={() => selectFilter("REVIEW")}>en revisión</button>
      </div>
    </header>

    <div className={styles.list} aria-live="polite" aria-busy={loading || busy}>
      {items.map((item) => <button key={item.id} type="button" className={styles.row} onClick={() => void open(item)} aria-label={`Revisar transferencia ${item.transactionCode}`}>
        <span className={styles.transferIcon}><Image src="/figma/admin-transfer.svg" alt="" width={54} height={54} /><small>transf.</small></span>
        <span className={styles.cell}><small>fecha</small><strong>{date.format(new Date(item.createdAt))}</strong></span>
        <span className={styles.cell}><small>cliente</small><strong>{item.clientName}</strong><em>{item.transactionCode}</em></span>
        <span className={styles.cell}><small>banco de origen</small><strong>{item.bank ?? "No identificado"}</strong></span>
        <span className={`${styles.cell} ${styles.expected}`}><small>valor a verificar</small><strong>{money.format(item.expectedTransferAmount)}</strong></span>
        <span className={`${styles.cell} ${styles.detected}`}><small>valor a recargar</small><strong>{money.format(item.requestedPautaAmount)}</strong></span>
        <StatusPill tone={statusTone(item.status)}>{verificationStatusLabel(item.status)}</StatusPill>
      </button>)}
      {loading && <><div className={styles.skeleton} /><div className={styles.skeleton} /></>}
      {!loading && (error || !items.length) && <p className={styles.message} role={error ? "alert" : undefined}>{error || "No hay verificaciones para este filtro."}</p>}
    </div>

    <ModalShell open={Boolean(selected)} labelledBy="verification-title" onClose={() => setSelected(null)} className={styles.modal}>{selected && <>
      <header className={styles.modalHeader}><div><small>verificación de transferencia</small><h2 id="verification-title">{selected.item.clientName}</h2><p>{selected.item.transactionCode}</p></div><StatusPill tone={statusTone(selected.detail.status)}>{verificationStatusLabel(selected.detail.status)}</StatusPill></header>
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
            <div><dt>Valor esperado</dt><dd>{money.format(selected.detail.expectedAmount)}</dd></div>
            <div><dt>Valor detectado</dt><dd data-match={selected.detail.amountMatches}>{selected.detail.detectedAmount == null ? "No detectado" : money.format(selected.detail.detectedAmount)}</dd></div>
            <div><dt>Banco</dt><dd>{selected.detail.ocr?.bank ?? "No identificado"}</dd></div>
            <div><dt>Código bancario</dt><dd>{selected.detail.ocr?.transactionCode ?? "No identificado"}</dd></div>
            <div><dt>Fecha detectada</dt><dd>{selected.detail.ocr?.detectedDate ?? "No detectada"}</dd></div>
            <div><dt>Confianza OCR</dt><dd>{selected.detail.ocr?.confidence == null ? "—" : `${Math.round(selected.detail.ocr.confidence)}%`}</dd></div>
          </dl>
          {selected.detail.decisionAudit && <div className={styles.audit}>
            <small>decisión registrada</small>
            <strong>{selected.detail.decisionAudit.decision === "APPROVE" ? "Aprobada" : selected.detail.decisionAudit.decision === "REVIEW" ? "En revisión" : "Rechazada"} por {selected.detail.decisionAudit.administratorUserId}</strong>
            <span>{date.format(new Date(selected.detail.decisionAudit.createdAt))}</span>
            {(selected.detail.decisionAudit.notes || selected.detail.decisionAudit.reviewReason || selected.detail.decisionAudit.rejectionReason) && <p>{selected.detail.decisionAudit.notes ?? selected.detail.decisionAudit.reviewReason ?? selected.detail.decisionAudit.rejectionReason}</p>}
          </div>}
          {selected.detail.reviewReason && <div className={styles.reviewNotice}>
            <small>Motivo de revisión</small>
            <p>{selected.detail.reviewReason}</p>
            <span>Actualizado {date.format(new Date(selected.detail.updatedAt ?? selected.detail.decisionAudit?.createdAt ?? selected.detail.createdAt))}</span>
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
