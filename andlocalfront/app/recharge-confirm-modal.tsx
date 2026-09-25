"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Check, CircleCheck, LoaderCircle, SquareExclamationPoint } from "lucide-react";
import Image from "next/image";
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import ModalShell from "./components/modal-shell";
import { formatAmount } from "./lib/format";
import type { RechargePlatform } from "./lib/recharges-api";
import styles from "./recharge-confirm-modal.module.css";

export type RechargeLine = { platform: RechargePlatform; amount: number };

type Props = {
  /* confirm: pide deslizar. sending: la recarga va al servidor. done: recibida. */
  step: "confirm" | "sending" | "done" | null;
  lines: readonly RechargeLine[];
  prepaid: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
};

const logos: Record<RechargePlatform, { src: string; width: number; height: number }> = {
  GOOGLE: { src: "/figma/google.svg", width: 24, height: 26 },
  META: { src: "/figma/meta.svg", width: 30, height: 20 },
  TIKTOK: { src: "/figma/tiktok-modal.svg", width: 22, height: 26 },
};

/* Deslizar para confirmar: una recarga mueve dinero y un clic suelto no basta.
   El puntero tiene que llevar el tirador hasta el final; con teclado, Enter o
   espacio sobre el tirador confirma, porque arrastrar no es posible ahí. */
function SlideToConfirm({ disabled, sending, onConfirm }: { disabled: boolean; sending: boolean; onConfirm: () => void }) {
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
        aria-label="Confirmar recarga: desliza hasta el final o pulsa Enter"
      >
        {sending ? <LoaderCircle className={styles.spin} size={22} aria-hidden="true" /> : <CircleCheck size={24} strokeWidth={1.75} aria-hidden="true" />}
      </motion.button>
    </div>
  );
}

export default function RechargeConfirmModal({ step, lines, prepaid, error, onConfirm, onClose }: Props) {
  const sending = step === "sending";
  // Mientras la recarga viaja no se puede cerrar: quedaría sin saber si entró.
  const close = () => { if (!sending) onClose(); };

  return (
    <ModalShell open={step !== null} labelledBy="recharge-confirm-title" className={styles.modal} onClose={close}>
      {step === "done"
        ? <div className={styles.layout}>
            <span className={`${styles.badge} ${styles.badgeDone}`} aria-hidden="true"><Check size={56} strokeWidth={3.5} /></span>
            <div className={styles.body}>
              <h2 id="recharge-confirm-title" className={styles.titleLarge}>Transacción recibida</h2>
              <ul className={styles.notes}>
                <li><SquareExclamationPoint size={24} strokeWidth={1.75} aria-hidden="true" />Tu factura te llegará de manera automática al correo o la podrás encontrar en tus transacciones en máximo 3 horas.</li>
                <li><SquareExclamationPoint size={24} strokeWidth={1.75} aria-hidden="true" />Tu dinero será agregado en máximo 5 horas.</li>
              </ul>
            </div>
          </div>
        : <div className={styles.layout}>
            <span className={`${styles.badge} ${styles.badgeAsk}`} aria-hidden="true">!</span>
            <div className={styles.body}>
              <h2 id="recharge-confirm-title">{prepaid ? "¿Estás seguro de tu transferencia?" : "¿Confirmas tu recarga?"}</h2>
              <ul className={styles.lines} aria-label="Montos por plataforma">
                {lines.map(({ platform, amount }) => {
                  const logo = logos[platform];
                  return <li key={platform}><span className={styles.logo}><Image src={logo.src} alt={platform === "TIKTOK" ? "TikTok" : platform === "META" ? "Meta" : "Google"} width={logo.width} height={logo.height} /></span><strong>{formatAmount(amount)}</strong></li>;
                })}
              </ul>
              <SlideToConfirm disabled={sending} sending={sending} onConfirm={onConfirm} />
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          </div>}
    </ModalShell>
  );
}
