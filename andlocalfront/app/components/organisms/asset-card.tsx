"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { AdvertisingPlatform } from "../../design-system/types";
import { formatAmount, formatDay } from "../../lib/format";
import styles from "./asset-card.module.css";

const config: Record<AdvertisingPlatform, { label: string; icon: string; card: string; iconClass: string }> = {
  tiktok: { label: "TikTok", icon: "/figma/tiktok.svg", card: styles.tiktokCard, iconClass: styles.tiktokIcon },
  meta: { label: "Meta", icon: "/figma/meta.svg", card: styles.metaCard, iconClass: styles.metaIcon },
  google: { label: "Google", icon: "/figma/google.svg", card: styles.googleCard, iconClass: styles.googleIcon },
};

/* La tarjeta de una plataforma en el mazo de activos. Cerrada enseña el saldo;
   abierta, además, la última recarga. Dónde va y en qué capa la decide el mazo:
   `className` la coloca y `offsetY`/`layer` la mueven y apilan. */
export default function AssetCard({ platform, balance, pending, lastRechargeAt, selected, offsetY, layer, reduceMotion, className = "", onSelect }: { platform: AdvertisingPlatform; balance: number; pending: number; lastRechargeAt: string | null; selected: boolean; offsetY: number; layer: number; reduceMotion: boolean | null; className?: string; onSelect: () => void }) {
  const item = config[platform];
  return <motion.button type="button" className={`${styles.card} ${item.card} ${className}`} data-selected={selected} aria-expanded={selected} aria-label={`Ver detalle de ${item.label}`} style={{ zIndex: layer }} initial={false} animate={{ transform: `translate3d(0, ${offsetY}px, 0)` }} transition={reduceMotion ? { duration: 0 } : { duration: .22, ease: [.23, 1, .32, 1] }} onClick={onSelect}>
    <span className={styles.content}>
      <span className={`${styles.icon} ${item.iconClass}`}><Image src={item.icon} alt="" fill sizes="64px" /></span>
      <span className={styles.lastRecharge}><small>última recarga</small><strong>{lastRechargeAt ? formatDay(lastRechargeAt) : "Sin recargas"}</strong></span>
      <span className={styles.balance}><small>saldo en plataforma</small><strong>{formatAmount(balance)}</strong>{pending > 0 && <small className={styles.pending}>+ {formatAmount(pending)} en camino</small>}</span>
    </span>
  </motion.button>;
}
