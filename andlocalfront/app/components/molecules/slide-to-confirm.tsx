"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import styles from "./slide-to-confirm.module.css";

/* Deslizar para confirmar: para acciones que mueven dinero, donde un clic suelto no basta.
   El puntero tiene que llevar el tirador hasta el final; con teclado, Enter o
   espacio sobre el tirador confirma, porque arrastrar no es posible ahí. */
export default function SlideToConfirm({ disabled, sending, label, onConfirm }: { disabled: boolean; sending: boolean; label: string; onConfirm: () => void }) {
  const reduceMotion = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [max, setMax] = useState(0);
  const x = useMotionValue(0);
  const hintOpacity = useTransform(x, (value) => (max ? Math.max(0, 1 - value / (max * .6)) : 1));
  const fill = useTransform(x, (value) => `${value + (handle.current?.offsetWidth ?? 0) / 2}px`);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => setMax(Math.max(0, element.clientWidth - (handle.current?.offsetWidth ?? 0) - 12));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Si el envío falla, el tirador vuelve al inicio para poder intentarlo de
  // nuevo. Si sale bien el modal pasa a «recibida» y esto ya no se ve.
  useEffect(() => { if (!sending) void animate(x, 0, { duration: reduceMotion ? 0 : .25 }); }, [sending, reduceMotion, x]);

  function complete() {
    void animate(x, max, { duration: reduceMotion ? 0 : .18 });
    onConfirm();
  }

  /* Arrastre con eventos de puntero propios: el tirador sigue al dedo o al
     ratón dentro de la pista y, al soltar, confirma solo si llegó al 90 %. */
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: x.get() };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    x.set(Math.min(max, Math.max(0, drag.current.startValue + event.clientX - drag.current.startX)));
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (max > 0 && x.get() >= max * .9) complete();
    else void animate(x, 0, reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 });
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    complete();
  }

  return (
    <div ref={track} className={styles.track} data-disabled={disabled}>
      <motion.span className={styles.fill} style={{ width: fill }} aria-hidden="true" />
      <motion.span className={styles.hint} style={{ opacity: hintOpacity }} aria-hidden="true">{sending ? "procesando…" : "desliza para confirmar"}</motion.span>
      <motion.button
        ref={handle}
        type="button"
        className={styles.handle}
        style={{ x }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={keyDown}
        disabled={disabled}
        aria-label={label}
      >
        {sending ? <LoaderCircle className={styles.spin} size={22} aria-hidden="true" /> : <CircleCheck size={24} strokeWidth={1.75} aria-hidden="true" />}
      </motion.button>
    </div>
  );
}
