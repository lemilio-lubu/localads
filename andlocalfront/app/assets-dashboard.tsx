"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import AccountShell from "./account-shell";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import type { AccountType } from "./design-system/types";
import { accountContext, getMyWallet, type PautaResponse, type RechargePlatform } from "./lib/recharges-api";
import styles from "./assets-dashboard.module.css";

const config: Record<RechargePlatform, { label: string; icon: string; card: string; iconClass: string }> = {
  TIKTOK: { label: "TikTok", icon: "/figma/tiktok.svg", card: styles.tiktokCard, iconClass: styles.tiktokIcon },
  META: { label: "Meta", icon: "/figma/meta.svg", card: styles.metaCard, iconClass: styles.metaIcon },
  GOOGLE: { label: "Google", icon: "/figma/google.svg", card: styles.googleCard, iconClass: styles.googleIcon },
};
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit" });

function AssetCard({ pauta, selected, position, layer, reduceMotion, onSelect }: { pauta: PautaResponse; selected: boolean; position: number; layer: number; reduceMotion: boolean | null; onSelect: () => void }) {
  const item = config[pauta.platform];
  return <motion.button type="button" className={`${styles.assetCard} ${styles.platformCard} ${item.card}`} data-selected={selected} aria-pressed={selected} aria-label={`Ver saldo de ${item.label}`} style={{ zIndex: layer }} initial={false} animate={{ transform: `translate3d(0, ${position}px, 0)` }} transition={reduceMotion ? { duration: 0 } : { duration: .22, ease: [.23, 1, .32, 1] }} onClick={onSelect}>
    <span className={styles.cardContent}>
      <span className={`${styles.assetIcon} ${item.iconClass}`}><Image src={item.icon} alt="" fill sizes="64px" /></span>
      <span className={styles.lastRecharge}><small>última recarga</small><strong>{pauta.lastRechargeAt ? date.format(new Date(pauta.lastRechargeAt)) : "Sin recargas"}</strong></span>
      <span className={styles.balance}><small>saldo disponible</small><strong>{money.format(pauta.currentBalance)}</strong></span>
    </span>
  </motion.button>;
}

export default function AssetsDashboard({ accountType }: { accountType: AccountType }) {
  const revision = usePlatformUpdates();
  const reduceMotion = useReducedMotion();
  const { clientId } = accountContext(accountType === "prepago" ? "prepago" : "flex");
  const [pautas, setPautas] = useState<PautaResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { let active = true; getMyWallet(clientId).then((wallet) => { if (active) { setPautas(wallet.pautas); setTotal(wallet.balanceTotal); setError(""); setSelected((current) => wallet.pautas.some((pauta) => pauta.id === current && pauta.status === "ACTIVE") ? current : null); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar tus activos"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision]);
  const visible = pautas.filter((pauta) => pauta.status === "ACTIVE");
  const others = visible.filter((pauta) => pauta.id !== selected);
  const positionFor = (pauta: PautaResponse, index: number) => !selected ? index * 120 : pauta.id === selected ? 0 : 224 + (others.findIndex((item) => item.id === pauta.id) + 1) * 40;
  const layerFor = (pauta: PautaResponse, index: number) => !selected ? index + 1 : pauta.id === selected ? 1 : others.findIndex((item) => item.id === pauta.id) + 2;

  return <AccountShell accountType={accountType} activePage="assets">
    <section className={styles.assetDeck} data-has-selection={selected !== null} aria-label="Balance de activos publicitarios" aria-busy={loading}>
      <div className={styles.deckBase} aria-hidden="true" />
      {visible.map((pauta, index) => <AssetCard key={pauta.id} pauta={pauta} selected={selected === pauta.id} position={positionFor(pauta, index)} layer={layerFor(pauta, index)} reduceMotion={reduceMotion} onSelect={() => setSelected((current) => current === pauta.id ? null : pauta.id)} />)}
      <article className={`${styles.assetCard} ${styles.totalCard}`}><span className={styles.cardContent}><span className={styles.totalBalance}><span>{loading ? "consultando balance…" : error ? "balance no disponible" : visible.length ? "balance total" : "sin pautas activas"}</span><strong>{error ? "—" : money.format(total)}</strong></span><Link href={`/${accountType}`}>{visible.length ? "recarga ahora" : "activar pauta"}</Link></span></article>
      {error && <p className={styles.dataMessage} role="alert">{error}</p>}
    </section>
  </AccountShell>;
}
