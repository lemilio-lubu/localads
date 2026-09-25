"use client";

import Image from "next/image";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import AccountShell from "./account-shell";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import type { AccountType } from "./design-system/types";
import { accountContext, getMyWallet, getRechargeContext, type PautaResponse, type RechargeContext, type RechargePlatform } from "./lib/recharges-api";
import { formatAmount, formatDay } from "./lib/format";
import styles from "./assets-dashboard.module.css";

const config: Record<RechargePlatform, { label: string; icon: string; card: string; iconClass: string }> = {
  TIKTOK: { label: "TikTok", icon: "/figma/tiktok.svg", card: styles.tiktokCard, iconClass: styles.tiktokIcon },
  META: { label: "Meta", icon: "/figma/meta.svg", card: styles.metaCard, iconClass: styles.metaIcon },
  GOOGLE: { label: "Google", icon: "/figma/google.svg", card: styles.googleCard, iconClass: styles.googleIcon },
};
/* Alto de cada franja cuando hay una tarjeta abierta. */
const STRIP = 40;
/* La abierta no sube hasta el borde del mazo: la base arranca 24px más abajo y
   dejarla en 0 la hacía sobresalir por encima del marco. Con 16 apenas asoma. */
const SELECTED_TOP = 16;
/* El mazo lo dimensiona el CSS —y lo encoge en las media queries—, así que sus
   medidas se leen de ahí en vez de repetirlas aquí. Antes el 112 estaba escrito
   en los dos sitios. */
const readMetrics = (element: HTMLElement) => {
  const computed = getComputedStyle(element);
  const read = (name: string, fallback: number) => parseFloat(computed.getPropertyValue(name)) || fallback;
  return { stride: read("--card-stride", 112), cardHeight: read("--card-height", 304) };
};

function AssetCard({ pauta, selected, position, layer, reduceMotion, onSelect }: { pauta: PautaResponse; selected: boolean; position: number; layer: number; reduceMotion: boolean | null; onSelect: () => void }) {
  const item = config[pauta.platform];
  return <motion.button type="button" className={`${styles.assetCard} ${styles.platformCard} ${item.card}`} data-selected={selected} aria-expanded={selected} aria-label={`Ver detalle de ${item.label}`} style={{ zIndex: layer }} initial={false} animate={{ transform: `translate3d(0, ${position}px, 0)` }} transition={reduceMotion ? { duration: 0 } : { duration: .22, ease: [.23, 1, .32, 1] }} onClick={onSelect}>
    <span className={styles.cardContent}>
      <span className={`${styles.assetIcon} ${item.iconClass}`}><Image src={item.icon} alt="" fill sizes="64px" /></span>
      <span className={styles.lastRecharge}><small>última recarga</small><strong>{pauta.lastRechargeAt ? formatDay(pauta.lastRechargeAt) : "Sin recargas"}</strong></span>
      <span className={styles.balance}><small>saldo disponible</small><strong>{formatAmount(pauta.currentBalance)}</strong></span>
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
  const [reloadToken, setReloadToken] = useState(0);
  const deckRef = useRef<HTMLElement>(null);
  const [metrics, setMetrics] = useState({ stride: 112, cardHeight: 304 });
  // ResizeObserver dispara al observar, así que la primera medida llega sola.
  useEffect(() => { const element = deckRef.current; if (!element) return; const observer = new ResizeObserver(() => setMetrics(readMetrics(element))); observer.observe(element); return () => observer.disconnect(); }, []);
  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  useEffect(() => { let active = true; void getRechargeContext().then((value) => { if (active) setContext(value); }).catch(() => undefined); getMyWallet(clientId).then((wallet) => { if (active) { setPautas(wallet.pautas); setTotal(wallet.balanceTotal); setError(""); setSelected((current) => wallet.pautas.some((pauta) => pauta.id === current && pauta.status === "ACTIVE") ? current : null); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar tus activos"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision, reloadToken]);
  const visible = pautas.filter((pauta) => pauta.status === "ACTIVE");
  /* Como en una billetera real, solo aparecen las tarjetas contratadas: las
     plataformas sin pauta activa no se pintan. Para activarlas está el enlace
     de la tarjeta de total. */
  const credit = context && context.account.type === "POSTPAGO" ? context.account : null;
  const others = visible.filter((pauta) => pauta.id !== selected);
  // El paso coincide con --card-stride del CSS; si cambia uno, cambia el otro.
  /* Con una tarjeta abierta, las demás arrancan donde ella termina y se apilan
     de 40 en 40. Antes empezaban en 224, es decir antes de que acabara, y el
     saldo de la abierta quedaba justo debajo del corte. */
  const stripTop = (order: number) => SELECTED_TOP + metrics.cardHeight + order * STRIP;
  const positionFor = (pauta: PautaResponse, index: number) => !selected ? index * metrics.stride : pauta.id === selected ? SELECTED_TOP : stripTop(others.findIndex((item) => item.id === pauta.id));
  /* La seleccionada va por DEBAJO a propósito: las demás la recortan por abajo y
     quedan como franjas finas, que es la composición del mockup. */
  const layerFor = (pauta: PautaResponse, index: number) => !selected ? index + 1 : pauta.id === selected ? 1 : others.findIndex((item) => item.id === pauta.id) + 2;
  // La del total baja con las franjas para no comerse la última.
  const totalTop = selected ? stripTop(others.length) : null;

  return <AccountShell accountType={accountType} activePage="assets"><>
    <section className={styles.assetDeck} ref={deckRef} style={{ "--card-count": Math.max(visible.length, 1), ...(totalTop === null ? {} : { "--total-top": `${totalTop}px` }) } as CSSProperties} data-has-selection={selected !== null} aria-label="Balance de activos publicitarios" aria-busy={loading}>
      <div className={styles.deckBase} aria-hidden="true" />
      {visible.map((pauta, index) => <AssetCard key={pauta.id} pauta={pauta} selected={selected === pauta.id} position={positionFor(pauta, index)} layer={layerFor(pauta, index)} reduceMotion={reduceMotion} onSelect={() => setSelected((current) => current === pauta.id ? null : pauta.id)} />)}
      <article className={`${styles.assetCard} ${styles.totalCard}`}><span className={styles.cardContent}><span className={styles.totalBalance}><span>{loading ? "consultando balance…" : error ? "balance no disponible" : visible.length ? "balance total" : "sin pautas activas"}</span><strong>{error ? "—" : formatAmount(total)}</strong></span><Link href={`/${accountType}`}>{visible.length ? "recarga ahora" : "activar pauta"}</Link>
        {credit && <span className={styles.creditLine}>crédito disponible <b>{formatAmount(credit.creditAvailable)}</b> de {formatAmount(credit.creditLimit)} · {credit.creditDays} días</span>}
      </span></article>
    </section>
    {error && <div className={styles.errorPanel} role="alert">
      <p><strong>No pudimos cargar tus activos</strong></p>
      <p>{error}</p>
      <button type="button" onClick={retry}><RotateCw size={16} aria-hidden="true" />reintentar</button>
    </div>}
  </></AccountShell>;
}
