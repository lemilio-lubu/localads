"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import AccountShell from "./account-shell";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import type { AccountType } from "./design-system/types";
import { accountContext, getMyWallet, getRechargeContext, type PautaResponse, type RechargeContext, type RechargePlatform } from "./lib/recharges-api";
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
  const [context, setContext] = useState<RechargeContext | null>(null);

  useEffect(() => { let active = true; void getRechargeContext().then((value) => { if (active) setContext(value); }).catch(() => undefined); getMyWallet(clientId).then((wallet) => { if (active) { setPautas(wallet.pautas); setTotal(wallet.balanceTotal); setError(""); setSelected((current) => wallet.pautas.some((pauta) => pauta.id === current && pauta.status === "ACTIVE") ? current : null); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar tus activos"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision]);
  const visible = pautas.filter((pauta) => pauta.status === "ACTIVE");
  // Las plataformas que faltan se muestran como naipe bloqueado: desde aqui
  // tambien se llega a activarlas, no solo desde el formulario de recarga.
  const credit = context && context.account.type === "POSTPAGO" ? context.account : null;
  const missing = (Object.keys(config) as RechargePlatform[])
    .filter((platform) => !visible.some((pauta) => pauta.platform === platform))
    .sort((a, b) => a.localeCompare(b));
  const others = visible.filter((pauta) => pauta.id !== selected);
  // El paso coincide con --card-stride del CSS; si cambia uno, cambia el otro.
  const stride = 112;
  const positionFor = (pauta: PautaResponse, index: number) => !selected ? index * stride : pauta.id === selected ? 0 : 224 + (others.findIndex((item) => item.id === pauta.id) + 1) * 40;
  const layerFor = (pauta: PautaResponse, index: number) => !selected ? index + 1 : pauta.id === selected ? 1 : others.findIndex((item) => item.id === pauta.id) + 2;

  return <AccountShell accountType={accountType} activePage="assets">
    <section className={styles.assetDeck} style={{ "--card-count": Math.max(visible.length + missing.length, 1) } as CSSProperties} data-has-selection={selected !== null} aria-label="Balance de activos publicitarios" aria-busy={loading}>
      <div className={styles.deckBase} aria-hidden="true" />
      {visible.map((pauta, index) => <AssetCard key={pauta.id} pauta={pauta} selected={selected === pauta.id} position={positionFor(pauta, index)} layer={layerFor(pauta, index)} reduceMotion={reduceMotion} onSelect={() => setSelected((current) => current === pauta.id ? null : pauta.id)} />)}
      {missing.map((platform, index) => {
        const item = config[platform];
        return <Link
          key={platform}
          href={`/${accountType}`}
          className={`${styles.assetCard} ${styles.platformCard} ${styles.lockedCard}`}
          style={{ zIndex: visible.length + index + 1, transform: `translate3d(0, ${(visible.length + index) * stride}px, 0)` }}
          aria-label={`Activar ${item.label}`}
        >
          <span className={styles.cardContent}>
            <span className={`${styles.assetIcon} ${item.iconClass}`}><Image src={item.icon} alt="" fill sizes="64px" /></span>
            <span className={styles.lockedLabel}><small>sin activar</small><strong>activar {item.label}</strong></span>
          </span>
        </Link>;
      })}
      <article className={`${styles.assetCard} ${styles.totalCard}`}><span className={styles.cardContent}><span className={styles.totalBalance}><span>{loading ? "consultando balance…" : error ? "balance no disponible" : visible.length ? "balance total" : "sin pautas activas"}</span><strong>{error ? "—" : money.format(total)}</strong></span><Link href={`/${accountType}`}>{visible.length ? "recarga ahora" : "activar pauta"}</Link>
        {credit && <span className={styles.creditLine}>crédito disponible <b>{money.format(credit.creditAvailable)}</b> de {money.format(credit.creditLimit)} · {credit.creditDays} días</span>}
      </span></article>
      {error && <p className={styles.dataMessage} role="alert">{error}</p>}
    </section>
  </AccountShell>;
}
