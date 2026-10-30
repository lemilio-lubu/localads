"use client";

import Image from "next/image";
import { ReactNode, useRef, useState } from "react";
import type { AccountType, AdvertisingPlatform } from "../design-system/types";
import { resolveApiAssetUrl, uploadPaymentReceipt, type ClientTransactionDetail, type TransactionDetail } from "../lib/recharges-api";
import { formatAmountOr, formatDateTimeOr } from "../lib/format";
import { paymentStatusLabel, rechargeStatusLabel, transactionDetailStatusLabel, verificationStatusLabel } from "../lib/status-labels";
import ModalShell from "./modal-shell";
import Disclosure from "./disclosure";
import PaymentAccountPanel from "./payment-account-panel";
import PlatformPill from "./platform-pill";
import StatusPill from "./status-pill";
import styles from "./invoice-detail-modal.module.css";
import FileViewer, { type ViewerFile } from "./file-viewer";
import { paymentStatusTone, rechargeStatusTone, verificationStatusTone } from "../lib/status-tone";
import { paymentVerificationMessage, pendingInvoiceLabel, platformList, rechargeMessage, rechargeSteps } from "../lib/transaction-progress";

/* El anillo dice si hay documento que abrir: verde si lo hay, gris si no.
   Antes cada documento tenía su color fijo -factura siempre gris, transferencia
   siempre verde- y una factura emitida parecía no disponible. */
/* El número lleva el código completo de la transacción y bajo el círculo se
   partía en cinco líneas. Se muestra hasta el primer tramo del código; el
   completo queda en el title y dentro del PDF. */
function shortInvoiceNumber(number: string): string {
  const parts = number.split("-");
  return parts.length > 3 ? `${parts.slice(0, 3).join("-")}…` : number;
}

/* Igual con el nombre del comprobante: se recorta el nombre y se conserva la
   extensión, que dice qué tipo de archivo es. */
function shortFileName(name: string, keep = 14): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const base = extension ? name.slice(0, dot) : name;
  return base.length > keep ? `${base.slice(0, keep).trimEnd()}…${extension}` : name;
}

const documentRing = { ready: "/figma/document-transfer.svg", pending: "/figma/document-invoice.svg" };

const icons: Record<AdvertisingPlatform, string> = { meta: "/figma/meta.svg", google: "/figma/google.svg", tiktok: "/figma/tiktok.svg" };

function DetailCard({ detail, actions }: { detail: TransactionDetail; actions?: ReactNode }) {
  const platform = detail.platform.toLowerCase() as AdvertisingPlatform;
  return <article className={`${styles.platformCard} ${styles[platform]}`}>
    <header><span className={styles.platformIcon}><Image src={icons[platform]} alt="" fill sizes="32px" /></span><PlatformPill platform={platform} /><StatusPill tone={detail.pausedAt ? "neutral" : rechargeStatusTone(detail.status)}>{detail.pausedAt ? "stop · pausada" : transactionDetailStatusLabel(detail.status)}</StatusPill></header>
    <dl>
      <div><dt>monto de pauta</dt><dd>{formatAmountOr(detail.requestedAmount)}</dd></div><div><dt>ISD (5%)</dt><dd>{formatAmountOr(detail.isdAmount)}</dd></div>
      <div><dt>comisión agencia (10%)</dt><dd>{formatAmountOr(detail.agencyFeeAmount)}</dd></div><div><dt>IVA (15%)</dt><dd>{formatAmountOr(detail.vatAmount)}</dd></div>
      <div><dt>total del detalle</dt><dd>{formatAmountOr(detail.totalAmount)}</dd></div><div className={styles.rechargeDate}><dt>fecha efectiva</dt><dd>{formatDateTimeOr(detail.effectiveRechargeDate)}</dd></div>
    </dl>
    {actions && <div className={styles.cardActions}>{actions}</div>}
  </article>;
}

/* El mismo detalle lo ven el cliente y el portal interno. Lo que solo hace el
   equipo -ejecutar la recarga plataforma por plataforma, completarla- entra
   por los huecos: `detailActions` dentro de cada tarjeta y `footer` debajo.
   El cliente no pasa ninguno y lo ve como siempre. */
type Props = {
  transaction: ClientTransactionDetail | null;
  onClose: () => void;
  /* Si no se pasa, sale del propio registro (accountTypeSnapshot). */
  accountType?: AccountType;
  /* El cliente sube aquí su comprobante; el equipo solo lo consulta. */
  onReceiptUploaded?: () => void;
  allowReceiptUpload?: boolean;
  subtitle?: string;
  detailActions?: (detail: TransactionDetail) => ReactNode;
  footer?: ReactNode;
  /* El cliente lee en qué punto está su recarga y qué falta; el equipo ya lo
     sabe por los estados y no recibe textos en segunda persona. */
  audience?: "client" | "team";
};

export default function InvoiceDetailModal({ accountType, transaction, onClose, onReceiptUploaded, allowReceiptUpload = true, subtitle, detailActions, footer, audience = "client" }: Props) {
  const receiptInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState<{ code: string; ok: boolean } | null>(null);
  /* Factura y comprobante se ven aquí mismo, en un visor encima del detalle. */
  const [viewing, setViewing] = useState<ViewerFile | null>(null);

  /* El código va como referencia de la transferencia. Si el portapapeles se
     niega, se dice y el código queda seleccionado para copiarlo a mano. */
  async function copyCode(code: string, element: HTMLElement | null) {
    let ok = true;
    try { await navigator.clipboard.writeText(code); }
    catch { ok = false; if (element) window.getSelection()?.selectAllChildren(element); }
    setCopied({ code, ok });
    window.setTimeout(() => setCopied((current) => current?.code === code ? null : current), 2400);
  }
  const copyState = copied?.code === transaction?.code ? (copied?.ok ? "done" : "failed") : undefined;

  // El pago admite comprobante mientras no este confirmado. Un pago rechazado
  // tambien lo admite: el cliente puede regularizar con una nueva evidencia.
  const payment = transaction?.payment ?? null;
  const acceptsReceipt = allowReceiptUpload && Boolean(payment) && ["IN_CREDIT", "OVERDUE", "REJECTED", "PENDING"].includes(payment!.status);
  const showPaymentData = acceptsReceipt;
  const postpaid = accountType ? accountType === "flex" : transaction?.accountTypeSnapshot === "POSTPAGO";

  async function sendReceipt(file: File | null | undefined) {
    if (!file || !payment) return;
    setUploading(true); setUploadError("");
    try {
      await uploadPaymentReceipt(payment.id, file);
      onReceiptUploaded?.();
    } catch (reason: unknown) {
      setUploadError(reason instanceof Error ? reason.message : "No fue posible cargar el comprobante");
    } finally {
      setUploading(false);
      if (receiptInput.current) receiptInput.current.value = "";
    }
  }

  const receipt = transaction?.payment?.receipts.at(-1);
  const forClient = audience === "client";
  const steps = transaction && forClient ? rechargeSteps(postpaid, transaction.rechargeStatus) : null;
  const progressMessage = transaction && forClient ? rechargeMessage(transaction.rechargeStatus, platformList(transaction.details.map((detail) => detail.platform)), Boolean(transaction.invoice?.documentUrl)) : "";
  return <ModalShell open={Boolean(transaction)} labelledBy="invoice-detail-title" className={`${styles.modal} ${footer ? styles.withFooter : ""} ${showPaymentData ? styles.withPayment : ""}`} onClose={onClose}>
    {transaction && <>
      <div className={styles.summary}>
        <h2 id="invoice-detail-title">Detalle de transacción</h2>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        <div className={styles.accountLabel}><Image src="/figma/pay.svg" alt="" width={24} height={24} /><strong>{postpaid ? "postpago" : "prepago"}</strong></div>
        <dl className={styles.transactionData}>
          <div><dt>Código</dt><dd><button type="button" className={styles.copyCode} data-state={copyState} title={transaction.code} onClick={(event) => void copyCode(transaction.code, event.currentTarget.querySelector("span"))}><span>{transaction.code}</span><small>{copyState === "done" ? "copiado" : copyState === "failed" ? "no se pudo" : "copiar"}</small></button></dd></div><div><dt>Fecha</dt><dd>{formatDateTimeOr(transaction.createdAt)}</dd></div>
          <div><dt>Estado de recarga</dt><dd><StatusPill tone={rechargeStatusTone(transaction.rechargeStatus)}>{rechargeStatusLabel(transaction.rechargeStatus)}</StatusPill></dd></div><div><dt>Estado de pago</dt><dd><StatusPill tone={paymentStatusTone(transaction.payment?.status)}>{paymentStatusLabel(transaction.payment?.status)}</StatusPill></dd></div>
          <div><dt>Inversión</dt><dd>{formatAmountOr(transaction.pautaAmount)}</dd></div><div><dt>Total</dt><dd>{formatAmountOr(transaction.totalAmount)}</dd></div>
          {transaction.payment?.dueDate && <div><dt>Vencimiento</dt><dd>{formatDateTimeOr(transaction.payment.dueDate)}</dd></div>}
        </dl>
        {forClient && progressMessage && <section className={styles.progress} aria-labelledby="recharge-progress-title">
          <strong id="recharge-progress-title">Avance de la recarga</strong>
          {steps && <ol>{steps.map((step, index) => <li key={step.label} data-reached={step.reached} aria-current={step.reached && !steps[index + 1]?.reached ? "step" : undefined}>{step.label}</li>)}</ol>}
          <p>{progressMessage}</p>
        </section>}
        {transaction.verification && <section className={styles.verificationSummary} aria-labelledby="verification-summary-title">
          <div><strong id="verification-summary-title">{forClient ? "Verificación de tu pago" : "Estado de verificación"}</strong><StatusPill tone={verificationStatusTone(transaction.verification.status)}>{verificationStatusLabel(transaction.verification.status)}</StatusPill></div>
          {forClient && paymentVerificationMessage(transaction.verification.status, postpaid) && <p>{paymentVerificationMessage(transaction.verification.status, postpaid)}</p>}
          {transaction.verification.reviewReason && <p><span>Motivo de revisión</span>{transaction.verification.reviewReason}</p>}
          <small>Actualizado {formatDateTimeOr(transaction.verification.updatedAt)}</small>
        </section>}
        <div className={styles.traceability}><strong>Resumen financiero</strong><ol><li>ISD: {formatAmountOr(transaction.isdAmount)}</li><li>Comisión: {formatAmountOr(transaction.agencyFeeAmount)}</li><li>IVA: {formatAmountOr(transaction.vatAmount)}</li></ol></div>
      </div>
      <div className={styles.documentActions} aria-label="Documentos de la transacción">
        {transaction.invoice?.documentUrl ? <button className={styles.documentAction} onClick={() => setViewing({ url: resolveApiAssetUrl(transaction.invoice!.documentUrl!), name: `factura ${transaction.invoice!.invoiceNumber}` })}><span className={styles.documentCircle}><Image src={documentRing.ready} alt="" fill sizes="64px" /><span>factura</span></span><small title={transaction.invoice.invoiceNumber}>{shortInvoiceNumber(transaction.invoice.invoiceNumber)}</small></button> : <button className={styles.documentAction} disabled><span className={styles.documentCircle}><Image src={documentRing.pending} alt="" fill sizes="64px" /><span>factura</span></span><small>{forClient ? pendingInvoiceLabel(transaction.rechargeStatus, Boolean(transaction.invoice)) : transaction.invoice ? "Pendiente de autorización" : "Se emite al completar"}</small></button>}
        {receipt ? <button className={styles.documentAction} onClick={() => setViewing({ url: resolveApiAssetUrl(receipt.url), name: receipt.originalName })}><span className={styles.documentCircle}><Image src={documentRing.ready} alt="" fill sizes="64px" /><span>transf.</span></span><small title={receipt.originalName}>{shortFileName(receipt.originalName)}</small></button> : <button className={styles.documentAction} disabled><span className={styles.documentCircle}><Image src={documentRing.pending} alt="" fill sizes="64px" /><span>transf.</span></span><small>Sin comprobante</small></button>}
        {acceptsReceipt && <div className={styles.uploadReceipt}>
          <input ref={receiptInput} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={(event) => void sendReceipt(event.target.files?.[0])} />
          <button type="button" className={styles.uploadButton} disabled={uploading} onClick={() => receiptInput.current?.click()}>{uploading ? "Cargando…" : receipt ? "Reemplazar transferencia" : "Subir transferencia"}</button>
          <small>JPG, PNG o PDF · hasta 5 MB</small>
          {uploadError && <small role="alert" className={styles.uploadError}>{uploadError}</small>}
        </div>}
      </div>
      {showPaymentData && payment && <Disclosure defaultOpen className={styles.payDetails} summaryClassName={styles.paySummary} summary="datos para pagar">
        <PaymentAccountPanel amount={payment.expectedAmount} />
      </Disclosure>}
      <div className={styles.platformGrid}>{transaction.details.map((detail) => <DetailCard key={detail.id} detail={detail} actions={detailActions?.(detail)} />)}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </>}
  </ModalShell>;
}
