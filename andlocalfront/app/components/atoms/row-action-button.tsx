import { MouseEventHandler, ReactNode } from "react";
import styles from "./row-action-button.module.css";

/* Acción dentro de una fila de listado (editar, restablecer, activar). */
export default function RowActionButton({ children, disabled = false, onClick }: { children: ReactNode; disabled?: boolean; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  return <button type="button" className={styles.button} disabled={disabled} onClick={onClick}>{children}</button>;
}
