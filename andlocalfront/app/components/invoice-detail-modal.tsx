"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { AccountType, AdvertisingPlatform } from "../design-system/types";
import { resolveApiAssetUrl, uploadPaymentReceipt, type ClientTransactionDetail, type TransactionDetail } from "../lib/recharges-api";
import { paymentStatusLabel, rechargeStatusLabel, transactionDetailStatusLabel, verificationStatusLabel } from "../lib/status-labels";
import ModalShell from "./modal-shell";
import PlatformPill from "./platform-pill";
import StatusPill from "./status-pill";
import styles from "./invoice-detail-modal.module.css";
import { openAuthenticatedFile } from "../lib/auth-api";
import { paymentStatusTone, rechargeStatusTone, verificationStatusTone } from "../lib/status-tone";

const icons: Record<AdvertisingPlatform, string> = { meta: "/figma/meta.svg", google: "/figma/google.svg", tiktok: "/figma/tiktok.svg" };
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const money = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);

function DetailCard({ detail }: { detail: TransactionDetail }) {
  const platform = detail.platform.toLowerCase() as AdvertisingPlatform;
  return <article className={`${styles.platformCard} ${styles[platform]}`}>
    <header><span className={styles.platformIcon}><Image src={icons[platform]} alt="" fill sizes="32px" /></span><PlatformPill platform={platform} /><StatusPill tone={detail.pausedAt ? "neutral" : rechargeStatusTone(detail.status)}>{detail.pausedAt ? "stop · pausada" : transactionDetailStatusLabel(detail.status)}</StatusPill></header>
    <dl>
      <div><dt>monto de pauta</dt><dd>{money(detail.requestedAmount)}</dd></div><div><dt>ISD (5%)</dt><dd>{money(detail.isdAmount)}</dd></div>
      <div><dt>comisión agencia (10%)</dt><dd>{money(detail.agencyFeeAmount)}</dd></div><div><dt>IVA (15%)</dt><dd>{money(detail.vatAmount)}</dd></div>
      <div><dt>total del detalle</dt><dd>{money(detail.totalAmount)}</dd></div><div className={styles.rechargeDate}><dt>fecha efectiva</dt><dd>{formatDate(detail.effectiveRechargeDate)}</dd></div>
    </dl>
  </article>;
}

export default function InvoiceDetailModal({ accountType, transaction, onClose, onReceiptUploaded }: { accountType: AccountType; transaction: ClientTransactionDetail | null; onClose: () => void; onReceiptUploaded?: () => void }) {
  const receiptInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // El pago admite comprobante mientras no este confirmado. Un pago rechazado
  // tambien lo admite: el cliente puede regularizar con una nueva evidencia.
  const payment = transaction?.payment ?? null;
  const acceptsReceipt = Boolean(payment) && ["IN_CREDIT", "OVERDUE", "REJECTED", "PENDING"].includes(payment!.status);

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
  return <ModalShell open={Boolean(transaction)} labelledBy="invoice-detail-title" className={styles.modal} onClose={onClose}>
    {transaction && <>
      <div className={styles.summary}>
        <h2 id="invoice-detail-title">Detalle de transacción</h2>
        <div className={styles.accountLabel}><Image src="/figma/pay.svg" alt="" width={24} height={24} /><strong>{accountType === "flex" ? "postpago" : "prepago"}</strong></div>
        <dl className={styles.transactionData}>
          <div><dt>Código</dt><dd>{transaction.code}</dd></div><div><dt>Fecha</dt><dd>{formatDate(transaction.createdAt)}</dd></div>
          <div><dt>Estado de recarga</dt><dd><StatusPill tone={rechargeStatusTone(transaction.rechargeStatus)}>{rechargeStatusLabel(transaction.rechargeStatus)}</StatusPill></dd></div><div><dt>Estado de pago</dt><dd><StatusPill tone={paymentStatusTone(transaction.payment?.status)}>{paymentStatusLabel(transaction.payment?.status)}</StatusPill></dd></div>
          <div><dt>Inversión</dt><dd>{money(transaction.pautaAmount)}</dd></div><div><dt>Total</dt><dd>{money(transaction.totalAmount)}</dd></div>
          {transaction.payment?.dueDate && <div><dt>Vencimiento</dt><dd>{formatDate(transaction.payment.dueDate)}</dd></div>}
        </dl>
        {transaction.verification && <section className={styles.verificationSummary} aria-labelledby="verification-summary-title">
          <div><strong id="verification-summary-title">Estado de verificación</strong><StatusPill tone={verificationStatusTone(transaction.verification.status)}>{verificationStatusLabel(transaction.verification.status)}</StatusPill></div>
          {transaction.verification.reviewReason && <p><span>Motivo de revisión</span>{transaction.verification.reviewReason}</p>}
          <small>Actualizado {formatDate(transaction.verification.updatedAt)}</small>
        </section>}
        <div className={styles.traceability}><strong>Resumen financiero</strong><ol><li>ISD: {money(transaction.isdAmount)}</li><li>Comisión: {money(transaction.agencyFeeAmount)}</li><li>IVA: {money(transaction.vatAmount)}</li></ol></div>
      </div>
      <div className={styles.documentActions} aria-label="Documentos de la transacción">
        {transaction.invoice?.documentUrl ? <button className={styles.documentAction} onClick={() => void openAuthenticatedFile(resolveApiAssetUrl(transaction.invoice!.documentUrl!))}><span className={styles.documentCircle}><Image src="/figma/document-invoice.svg" alt="" fill sizes="64px" /><span>factura</span></span><small>{transaction.invoice.invoiceNumber}</small></button> : <button className={styles.documentAction} disabled><span className={styles.documentCircle}><Image src="/figma/document-invoice.svg" alt="" fill sizes="64px" /><span>factura</span></span><small>Se emite al completar</small></button>}
        {receipt ? <button className={styles.documentAction} onClick={() => void openAuthenticatedFile(resolveApiAssetUrl(receipt.url))}><span className={styles.documentCircle}><Image src="/figma/document-transfer.svg" alt="" fill sizes="64px" /><span>transf.</span></span><small>{receipt.originalName}</small></button> : <button className={styles.documentAction} disabled><span className={styles.documentCircle}><Image src="/figma/document-transfer.svg" alt="" fill sizes="64px" /><span>transf.</span></span><small>Sin comprobante</small></button>}
        {acceptsReceipt && <div className={styles.uploadReceipt}>
          <input ref={receiptInput} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={(event) => void sendReceipt(event.target.files?.[0])} />
          <button type="button" disabled={uploading} onClick={() => receiptInput.current?.click()}>{uploading ? "Cargando…" : receipt ? "Reemplazar transferencia" : "Subir transferencia"}</button>
          <small>JPG, PNG o PDF · hasta 5 MB</small>
          {uploadError && <small role="alert" className={styles.uploadError}>{uploadError}</small>}
        </div>}
      </div>
      <div className={styles.platformGrid}>{transaction.details.map((detail) => <DetailCard key={detail.id} detail={detail} />)}</div>
    </>}
  </ModalShell>;
}
