import type { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import CheckMark from "../atoms/check-mark";
import styles from "./choice-card.module.css";

/* Tarjeta de elección. El input nativo sigue ahí, invisible pero enfocable:
   teclado y lector de pantalla funcionan igual que con un radio o un checkbox
   de siempre. Con detalle, título y detalle van juntos; sin él, el título va
   solo (las plataformas, que ponen su logo en `leading`). */
export default function ChoiceCard({ type = "radio", name, value, checked, onChange, Icon, leading, title, detail, platform, className }: { type?: "radio" | "checkbox"; name?: string; value?: string; checked: boolean; onChange: () => void; Icon?: LucideIcon; leading?: ReactNode; title: ReactNode; detail?: string; platform?: string; className?: string }) {
  return (
    <label className={className ? `${styles.choice} ${className}` : styles.choice} data-platform={platform}>
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} />
      {Icon && <Icon className={styles.choiceIcon} size={20} strokeWidth={1.75} aria-hidden="true" />}
      {leading}
      {detail === undefined ? <strong>{title}</strong> : <span className={styles.choiceText}><strong>{title}</strong><small>{detail}</small></span>}
      {/* Marca redonda; se rellena cuando el input de la tarjeta está marcado. */}
      <CheckMark checked={checked} className={styles.choiceCheck} />
    </label>
  );
}

/* Dos columnas de tarjetas de un mismo grupo de radios (una en pantallas estrechas). */
export function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.choices} role="radiogroup" aria-label={label}>{children}</div>;
}
