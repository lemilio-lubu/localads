import { ReactNode } from "react";
import styles from "./row-actions.module.css";

/* La columna de acciones de una fila. Encima del enlace que abre la fila (z-index)
   para que sus botones reciban el clic. Cómo se reparte en pantallas estrechas
   lo decide cada listado con `className`. */
export default function RowActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.actions} ${className}`}>{children}</div>;
}
