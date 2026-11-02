import type { LucideIcon } from "lucide-react";
import styles from "./form-header.module.css";

/* Cabecera con el lenguaje del detalle de cliente: etiqueta en pastilla gris
   («cliente», «equipo») y título grande debajo. */
export default function FormHeader({ Icon, eyebrow, title, subtitle, titleId }: { Icon: LucideIcon; eyebrow: string; title: string; subtitle?: string; titleId: string }) {
  return (
    <header className={styles.header}>
      <span className={styles.eyebrow}><Icon size={14} strokeWidth={2} aria-hidden="true" />{eyebrow}</span>
      <h2 id={titleId}>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}
