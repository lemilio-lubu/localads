import { MouseEventHandler, ReactNode } from "react";
import styles from "./text-button.module.css";

/* Acción secundaria con aspecto de enlace: «limpiar filtros» junto a un listado. */
export default function TextButton({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  return <button type="button" className={`${styles.button} ${className}`} onClick={onClick}>{children}</button>;
}
