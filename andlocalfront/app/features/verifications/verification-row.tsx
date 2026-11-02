import Image from "next/image";
import DateCell from "../../components/atoms/date-cell";
import StatusPill from "../../components/atoms/status-pill";
import CopyCode from "../../components/molecules/copy-code";
import type { PendingVerification } from "../../lib/admin-recharges-api";
import { formatAmount } from "../../lib/format";
import { verificationStatusLabel } from "../../lib/status-labels";
import { verificationStatusTone } from "../../lib/status-tone";
import styles from "./verification-row.module.css";

/* Una transferencia por verificar en la lista. Abrir la revisión lo resuelve
   la pantalla: aquí solo se pinta y se avisa. */
export default function VerificationRow({ item, busy, onOpen }: { item: PendingVerification; busy: boolean; onOpen: () => void }) {
  return <article className={styles.row}>
    <span className={styles.transferIcon}><Image src="/figma/admin-transfer.svg" alt="" width={54} height={54} /><small>transf.</small></span>
    <DateCell value={item.createdAt} />
    <div className={`${styles.cell} ${styles.codeCell}`}><strong>cliente</strong><span className={styles.clientName}>{item.clientName}</span>
      <CopyCode code={item.transactionCode} tone="strong" size="small" mono />
    </div>
    <div className={styles.cell}><strong>banco de origen</strong><span>{item.bank ?? "No identificado"}</span></div>
    <div className={styles.cell}><strong>a verificar / a recargar</strong><span className={styles.expected}>{formatAmount(item.expectedTransferAmount)}</span><span className={styles.detected}>recarga {formatAmount(item.requestedPautaAmount)}</span></div>
    <div className={styles.cell}><strong>estado</strong><StatusPill tone={verificationStatusTone(item.status)}>{verificationStatusLabel(item.status)}</StatusPill>{item.decidedByName && <span className={styles.holder}>por {item.decidedByName}</span>}</div>
    <button type="button" className={styles.reviewButton} aria-haspopup="dialog" disabled={busy} onClick={onOpen}>revisar</button>
  </article>;
}
