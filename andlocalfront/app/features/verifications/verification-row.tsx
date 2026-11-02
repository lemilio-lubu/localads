import Image from "next/image";
import DateCell from "../../components/atoms/date-cell";
import StatusPill from "../../components/atoms/status-pill";
import type { PendingVerification } from "../../lib/admin-recharges-api";
import { formatAmount } from "../../lib/format";
import { verificationStatusLabel } from "../../lib/status-labels";
import { verificationStatusTone } from "../../lib/status-tone";
import styles from "./verification-row.module.css";

/* Una transferencia por verificar en la lista. Copiar el código y abrir la
   revisión los resuelve la pantalla: aquí solo se pinta y se avisa. */
export default function VerificationRow({ item, copyState, copyLabel, busy, onCopy, onOpen }: { item: PendingVerification; copyState?: "done" | "failed"; copyLabel: string; busy: boolean; onCopy: (element: HTMLElement | null) => void; onOpen: () => void }) {
  return <article className={styles.row}>
    <span className={styles.transferIcon}><Image src="/figma/admin-transfer.svg" alt="" width={54} height={54} /><small>transf.</small></span>
    <DateCell value={item.createdAt} />
    <div className={`${styles.cell} ${styles.codeCell}`}><strong>cliente</strong><span className={styles.clientName}>{item.clientName}</span>
      <button type="button" className={styles.copyCode} data-state={copyState} title={item.transactionCode} onClick={(event) => onCopy(event.currentTarget.querySelector("span"))}>
        <span>{item.transactionCode}</span><small>{copyLabel}</small>
      </button>
    </div>
    <div className={styles.cell}><strong>banco de origen</strong><span>{item.bank ?? "No identificado"}</span></div>
    <div className={styles.cell}><strong>a verificar / a recargar</strong><span className={styles.expected}>{formatAmount(item.expectedTransferAmount)}</span><span className={styles.detected}>recarga {formatAmount(item.requestedPautaAmount)}</span></div>
    <div className={styles.cell}><strong>estado</strong><StatusPill tone={verificationStatusTone(item.status)}>{verificationStatusLabel(item.status)}</StatusPill>{item.decidedByName && <span className={styles.holder}>por {item.decidedByName}</span>}</div>
    <button type="button" className={styles.reviewButton} aria-haspopup="dialog" disabled={busy} onClick={onOpen}>revisar</button>
  </article>;
}
