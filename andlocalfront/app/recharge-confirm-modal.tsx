"use client";

import { Check, SquareExclamationPoint } from "lucide-react";
import Image from "next/image";
import TextLink from "./components/atoms/text-link";
import SlideToConfirm from "./components/molecules/slide-to-confirm";
import ModalShell from "./components/organisms/modal-shell";
import { formatAmount } from "./lib/format";
import type { RechargePlatform } from "./lib/recharges-api";
import styles from "./recharge-confirm-modal.module.css";

export type RechargeLine = { platform: RechargePlatform; amount: number };

type Props = {
  /* confirm: pide deslizar. sending: la recarga va al servidor. done: recibida. */
  step: "confirm" | "sending" | "done" | null;
  lines: readonly RechargeLine[];
  prepaid: boolean;
  /* «Produbanco ••••5407»: a dónde debió ir la transferencia, para confirmarlo antes de enviar. */
  destination?: string | null;
  /* Dónde están los datos para pagar; solo se ofrece al pospago, que paga después. */
  payHref?: string;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
};

const logos: Record<RechargePlatform, { src: string; width: number; height: number }> = {
  GOOGLE: { src: "/figma/google.svg", width: 24, height: 26 },
  META: { src: "/figma/meta.svg", width: 30, height: 20 },
  TIKTOK: { src: "/figma/tiktok-modal.svg", width: 22, height: 26 },
};

export default function RechargeConfirmModal({ step, lines, prepaid, destination, payHref, error, onConfirm, onClose }: Props) {
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
                {!prepaid && payHref && <li><SquareExclamationPoint size={24} strokeWidth={1.75} aria-hidden="true" /><span>Paga antes del vencimiento. Los datos de la cuenta están en <TextLink href={payHref} size="inherit">cómo pagar</TextLink>.</span></li>}
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
              {prepaid && destination && <p className={styles.destination}>Comprueba que transferiste a <strong>{destination}</strong>.</p>}
              <SlideToConfirm disabled={sending} sending={sending} label="Confirmar recarga: desliza hasta el final o pulsa Enter" onConfirm={onConfirm} />
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          </div>}
    </ModalShell>
  );
}
