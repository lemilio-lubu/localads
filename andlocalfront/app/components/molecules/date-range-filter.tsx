"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { TextInput } from "../atoms/text-field";
import { dayPresets, dayRangeLabel, emptyDayRange, type DayRange } from "../../lib/date-range";
import styles from "./date-range-filter.module.css";

/* Filtro de fecha en forma de pastilla, para barras que ya van llenas. Cerrada
   ocupa lo mismo que «sin asignar»; con un rango activo se rellena, dice el
   rango («1 – 8 nov») y lleva su × para quitarlo. Abierta muestra los atajos
   habituales y los mismos dos campos que «Tus facturas». */
export default function DateRangeFilter({ value, onChange, className = "" }: { value: DayRange; onChange: (range: DayRange) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const active = Boolean(value.from || value.to);
  const label = active ? dayRangeLabel(value) : "fecha";

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  /* El panel cuelga del borde izquierdo de la pastilla. Si la pastilla queda a
     la derecha (escritorio, o la última de una fila en móvil), el panel se
     saldría de la pantalla: se corre hacia la izquierda lo justo. */
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 16;
    const rect = panelRef.current.getBoundingClientRect();
    const overflow = rect.right - shift - (document.documentElement.clientWidth - gutter);
    setShift(overflow > 0 ? -overflow : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se mide una vez por apertura
  }, [open]);

  function choose(range: DayRange) { onChange(range); setOpen(false); triggerRef.current?.focus(); }

  return (
    <div ref={rootRef} className={`${styles.root} ${className}`}>
      <span className={styles.chip} data-active={active || undefined}>
        <button ref={triggerRef} type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} aria-label={active ? `Fecha: ${label}. Cambiar` : "Filtrar por fecha"} onClick={() => setOpen((current) => !current)}>
          <CalendarDays size={15} aria-hidden="true" />{label}
        </button>
        {active && <button type="button" className={styles.clear} aria-label="Quitar el filtro de fecha" onClick={() => onChange(emptyDayRange)}><X size={14} aria-hidden="true" /></button>}
      </span>
      {open && <div ref={panelRef} id={panelId} role="group" aria-label="Filtrar por fecha" className={styles.panel} style={{ translate: `${shift}px 0` }}>
        <div className={styles.presets}>
          {dayPresets.map((preset) => {
            const range = preset.range();
            const pressed = range.from === value.from && range.to === value.to;
            return <button key={preset.label} type="button" className={styles.preset} aria-pressed={pressed} onClick={() => choose(range)}>{preset.label}</button>;
          })}
        </div>
        <div className={styles.range}>
          <TextInput surface="filled" shape="pill" size="button" type="date" aria-label="Desde" value={value.from} max={value.to || undefined} onChange={(event) => onChange({ ...value, from: event.target.value })} />
          <span aria-hidden="true">–</span>
          <TextInput surface="filled" shape="pill" size="button" type="date" aria-label="Hasta" value={value.to} min={value.from || undefined} onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </div>
      </div>}
    </div>
  );
}
