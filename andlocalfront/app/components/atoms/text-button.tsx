import { MouseEventHandler, ReactNode } from "react";
import styles from "./text-button.module.css";

/* Acción secundaria con aspecto de enlace: «limpiar filtros» junto a un
   listado o «reintentar» dentro de un mensaje de error. Con size="inherit"
   toma la letra del texto que lo rodea; con tone="inherit", también su color
   (el rojo de un error, por ejemplo). */
export default function TextButton({ children, className = "", size = "caption", tone = "brand", onClick }: { children: ReactNode; className?: string; size?: "caption" | "inherit"; tone?: "brand" | "inherit"; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  return <button type="button" className={`${styles.button} ${className}`} data-size={size} data-tone={tone} onClick={onClick}>{children}</button>;
}
