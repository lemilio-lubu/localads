import styles from "./status-pill.module.css";

import type { StatusTone } from "../lib/status-tone";

type StatusPillProps = {
  children: string;
  tone?: StatusTone;
};

export default function StatusPill({ children, tone = "success" }: StatusPillProps) {
  return <span className={`${styles.status} ${styles[tone]}`}>{children}</span>;
}
