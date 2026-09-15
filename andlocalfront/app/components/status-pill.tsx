import styles from "./status-pill.module.css";

type StatusPillProps = {
  children: string;
  tone?: "success" | "danger" | "neutral";
};

export default function StatusPill({ children, tone = "success" }: StatusPillProps) {
  return <span className={`${styles.status} ${styles[tone]}`}>{children}</span>;
}
