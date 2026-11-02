import { ReactNode } from "react";
import styles from "./row-detail-link.module.css";

/* «ver detalles» / «revisar» al final de una fila de listado: abre el detalle en
   un diálogo. Tiene aspecto de enlace, pero es un botón. Dónde se coloca en la
   rejilla de la fila lo pone la pantalla con className. */
export default function RowDetailLink({ children, className = "", disabled, onClick }: { children: ReactNode; className?: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.link} ${className}`} aria-haspopup="dialog" disabled={disabled} onClick={onClick}>{children}</button>;
}
