"use client";

import Image from "next/image";
import { Check, CircleAlert, ExternalLink, RotateCw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import StatusPill from "../../components/atoms/status-pill";
import ModalShell from "../../components/organisms/modal-shell";
import { authenticatedFetch, openAuthenticatedFile } from "../../lib/auth-api";
import type { AdminVerification, PendingVerification, VerificationStatus } from "../../lib/admin-recharges-api";
import { formatAmount, formatDateTime } from "../../lib/format";
import { paymentDestinationLabel } from "../payments/payment-account-panel";
import { usePaymentAccount } from "../../lib/use-payment-account";
import { resolveApiAssetUrl } from "../../lib/recharges-api";
import { verificationIssueLabel, verificationStatusLabel } from "../../lib/status-labels";
import { verificationStatusTone } from "../../lib/status-tone";
import styles from "./verification-review-modal.module.css";
import { TextArea } from "../../components/atoms/text-field";

export type VerificationSelection = { item: PendingVerification; detail: AdminVerification };

const reviewStatuses: VerificationStatus[] = ["EN_REVISION", "VERIFICADA_AUTOMATICAMENTE"];

type Props = {
  selected: VerificationSelection | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApprove: () => void;
  /* Devuelve si se envió: solo entonces se cierra el formulario del motivo. */
  onReview: (reason: string) => Promise<boolean>;
  onRetryOcr: () => void;
};

/* La revisión de una transferencia: comprobante a la izquierda, datos a validar
   y la decisión a la derecha. Las decisiones las ejecuta la pantalla, que es
   quien refresca la lista. */
export default function VerificationReviewModal({ selected, ...props }: Props) {
  /* Fuera del contenido para que la cuenta de cobro se pida al cargar la
     pantalla y no al abrir cada revisión. */
  const [paymentAccount] = usePaymentAccount();
  const destination = paymentAccount.status === "ready" ? paymentDestinationLabel(paymentAccount.data.account) ?? "No configurada" : "—";
  return <ModalShell open={Boolean(selected)} labelledBy="verification-title" onClose={props.onClose} className={styles.modal}>{selected && <ReviewContent selected={selected} destination={destination} {...props} />}</ModalShell>;
}

/* Se monta al abrir y se desmonta al cerrar: comprobante y motivo empiezan de
   cero en cada revisión. */
function ReviewContent({ selected, destination, busy, error, onApprove, onReview, onRetryOcr }: Omit<Props, "selected" | "onClose"> & { selected: VerificationSelection; destination: string }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
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

  /* Solo un fallo de lectura sin ninguna decisión firmada se puede repetir:
     el backend lo vuelve a comprobar, esto solo decide si ofrecer el botón. */
  const canRetryOcr = selected.detail.status === "EN_REVISION" && selected.detail.receipt.status === "FAILED" && selected.detail.decisionAudit === null;
  const hardBlocked = selected.detail.issues.some((issue) => ["COMPROBANTE_DUPLICADO", "REFERENCIA_BANCARIA_DUPLICADA"].includes(issue));

  async function sendReview() {
    if (await onReview(reason)) { setReviewing(false); setReason(""); }
  }

  return <>
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
          <div><dt>Cuenta de cobro</dt><dd>{destination}</dd></div>
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
        {canRetryOcr && <div className={styles.actions}><button type="button" disabled={busy} onClick={onRetryOcr}><RotateCw size={17} />{busy ? "Leyendo…" : "Reintentar lectura"}</button></div>}
        {reviewStatuses.includes(selected.detail.status) && <div className={styles.actions}>{reviewing ? <div className={styles.reviewForm}><label>Motivo de revisión<TextArea surface="soft" tone="amber" autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" onClick={() => { setReviewing(false); setReason(""); }}>Cancelar</button><button type="button" disabled={!reason.trim() || busy} onClick={() => void sendReview()}><CircleAlert size={16} />Enviar a revisión</button></div></div> : <><button type="button" disabled={busy} onClick={() => { setReason(selected.detail.reviewReason ?? ""); setReviewing(true); }}><CircleAlert size={17} />En revisión</button><button type="button" disabled={busy || hardBlocked} title={hardBlocked ? "La evidencia duplicada no puede aprobarse" : undefined} onClick={onApprove}><Check size={17} />Aprobar transferencia</button></>}</div>}
        {hardBlocked && !reviewing && <p className={styles.error}>La aprobación está bloqueada: el comprobante o código bancario ya fue utilizado.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    </div>
  </>;
}
