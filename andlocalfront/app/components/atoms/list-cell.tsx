import type { ReactNode } from "react";
import styles from "./list-row.module.css";

/* Celda de la fila canónica (`patrones-lista.md`): etiqueta siempre visible
   encima y debajo el dato, que lleva el peso. La pantalla puede pasar su
   propia clase para reglas como `.cell > .amount`. */
export default function ListCell({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.cell} ${className}`}>
      <strong>{label}</strong>
      {children}
    </div>
  );
}
