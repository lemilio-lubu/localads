"use client";

import type { LucideIcon } from "lucide-react";
import styles from "./segmented-filter.module.css";

/* Filtro excluyente del portal. Estaba copiado en tres pantallas y las tres
   habían divergido: distinto orden, distinto atributo y un hexadecimal suelto.
   El tono es genérico a propósito — un componente compartido no tiene por qué
   saber qué es POSTPAGO ni REVIEW. */
export type SegmentTone = "neutral" | "brand" | "teal" | "amber";
export type SegmentOption<T> = { value: T; label: string; Icon: LucideIcon; tone?: SegmentTone };

type SegmentedFilterProps<T> = {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export default function SegmentedFilter<T>({ label, options, value, onChange }: SegmentedFilterProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          className={styles.segment}
          data-tone={option.tone ?? "neutral"}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <option.Icon size={15} aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
