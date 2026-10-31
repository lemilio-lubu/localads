"use client";

import { ReactNode } from "react";
import styles from "./toggle-chip.module.css";

type ToggleChipProps = {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
};

export default function ToggleChip({ pressed, onClick, children, className = "" }: ToggleChipProps) {
  return <button type="button" className={`${styles.chip} ${className}`} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}
