import { ReactNode } from "react";
import styles from "./metric-card.module.css";

type MetricCardProps = {
  label: string;
  children: ReactNode;
  tone?: "default" | "success" | "danger";
  valueSize?: "regular" | "small";
  /* Solo para texto libre (correo, nombre): un importe, un estado o una fecha
     nunca se recortan. El valor completo queda en `title`. */
  truncate?: boolean;
  className?: string;
};

export default function MetricCard({ label, children, tone = "default", valueSize = "regular", truncate = false, className = "" }: MetricCardProps) {
  const title = truncate && (typeof children === "string" || typeof children === "number") ? String(children) : undefined;
  return <div className={`${styles.card} ${styles[tone]} ${valueSize === "small" ? styles.small : ""} ${className}`}><small>{label}</small><strong className={truncate ? styles.truncate : undefined} title={title}>{children}</strong></div>;
}
