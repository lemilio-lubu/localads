"use client";

import { ReactNode } from "react";
import styles from "./toggle-chip.module.css";

/* Cómo se ve que está pulsado: un anillo alrededor (por defecto), el propio
   contenido (la pastilla de plataforma ya cambia de relleno) o un fondo de marca. */
type ToggleChipProps = {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  indicator?: "ring" | "content" | "fill";
};

export default function ToggleChip({ pressed, onClick, children, className = "", indicator = "ring" }: ToggleChipProps) {
  return <button type="button" className={`${styles.chip} ${className}`} data-indicator={indicator} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}
