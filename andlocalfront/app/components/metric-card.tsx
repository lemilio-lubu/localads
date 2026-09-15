import { ReactNode } from "react";
import styles from "./metric-card.module.css";

type MetricCardProps = { label: string; children: ReactNode; tone?: "default" | "success" | "danger"; valueSize?: "regular" | "small"; className?: string };

export default function MetricCard({ label, children, tone = "default", valueSize = "regular", className = "" }: MetricCardProps) {
  return <div className={`${styles.card} ${styles[tone]} ${valueSize === "small" ? styles.small : ""} ${className}`}><small>{label}</small><strong>{children}</strong></div>;
}
