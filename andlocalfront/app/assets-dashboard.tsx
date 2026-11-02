"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import AccountShell from "./account-shell";
import AssetCard from "./components/organisms/asset-card";
import LoadError from "./components/molecules/load-error";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import type { AccountType, AdvertisingPlatform } from "./design-system/types";
import { accountContext, getMyWallet, getRechargeContext, type PautaResponse, type RechargeContext, type RechargePlatform } from "./lib/recharges-api";
import { formatAmount } from "./lib/format";
import styles from "./assets-dashboard.module.css";

const platformKey: Record<RechargePlatform, AdvertisingPlatform> = { TIKTOK: "tiktok", META: "meta", GOOGLE: "google" };
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
  return { stride: read("--card-stride", 112), cardHeight: read("--card-height", 304), openOverlap: read("--open-overlap", 32) };
};

export default function AssetsDashboard({ accountType }: { accountType: AccountType }) {
  const revision = usePlatformUpdates();
  const reduceMotion = useReducedMotion();
  const { clientId } = accountContext(accountType === "prepago" ? "prepago" : "flex");
  const [pautas, setPautas] = useState<PautaResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [context, setContext] = useState<RechargeContext | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [metrics, setMetrics] = useState({ stride: 112, cardHeight: 304, openOverlap: 32 });
  /* Ref de callback y no useEffect: AccountShell no pinta el mazo hasta autorizar,
     y un efecto de montaje lo encontraba en null y nunca leía las medidas de móvil.
     ResizeObserver dispara al observar, así que la primera medida llega sola. */
  const observeDeck = useCallback((element: HTMLElement | null) => { if (!element) return; const observer = new ResizeObserver(() => setMetrics(readMetrics(element))); observer.observe(element); return () => observer.disconnect(); }, []);
  function retry() { setLoading(true); setError(""); setReloadToken((token) => token + 1); }

  useEffect(() => { let active = true; void getRechargeContext().then((value) => { if (active) setContext(value); }).catch(() => undefined); getMyWallet(clientId).then((wallet) => { if (active) { setPautas(wallet.pautas); setTotal(wallet.balanceTotal); setPendingTotal(wallet.pendingTotal); setError(""); setSelected((current) => wallet.pautas.some((pauta) => pauta.id === current && pauta.status === "ACTIVE") ? current : null); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar tus activos"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [clientId, revision, reloadToken]);
  const visible = pautas.filter((pauta) => pauta.status === "ACTIVE");
  /* Como en una billetera real, solo aparecen las tarjetas contratadas: las
     plataformas sin pauta activa no se pintan. Para activarlas está el enlace
     de la tarjeta de total. */
  const credit = context && context.account.type === "POSTPAGO" ? context.account : null;
  const others = visible.filter((pauta) => pauta.id !== selected);
  // El paso coincide con --card-stride del CSS; si cambia uno, cambia el otro.
  /* Con una tarjeta abierta, las demás se apilan de 40 en 40 y la primera sube
     --open-overlap sobre ella. Antes empezaban en 224, 80px antes de que
     acabara, y tapaban el saldo de la abierta; luego quedaron a ras. */
  const stripTop = (order: number) => SELECTED_TOP + metrics.cardHeight - metrics.openOverlap + order * STRIP;
  const positionFor = (pauta: PautaResponse, index: number) => !selected ? index * metrics.stride : pauta.id === selected ? SELECTED_TOP : stripTop(others.findIndex((item) => item.id === pauta.id));
  /* La seleccionada va por DEBAJO a propósito: las demás la recortan por abajo y
     quedan como franjas finas, que es la composición del mockup. */
  const layerFor = (pauta: PautaResponse, index: number) => !selected ? index + 1 : pauta.id === selected ? 1 : others.findIndex((item) => item.id === pauta.id) + 2;
  // La del total baja con las franjas para no comerse la última.
  const totalTop = selected ? stripTop(others.length) : null;

  return <AccountShell accountType={accountType} activePage="assets" contentAlign="center"><>
    <section className={styles.assetDeck} ref={observeDeck} style={{ "--card-count": Math.max(visible.length, 1), ...(totalTop === null ? {} : { "--total-top": `${totalTop}px` }) } as CSSProperties} data-has-selection={selected !== null} aria-label="Balance de activos publicitarios" aria-busy={loading}>
      <div className={styles.deckBase} aria-hidden="true" />
      {visible.map((pauta, index) => <AssetCard key={pauta.id} className={styles.deckSlot} platform={platformKey[pauta.platform]} balance={pauta.currentBalance} pending={pauta.pendingAmount} lastRechargeAt={pauta.lastRechargeAt} selected={selected === pauta.id} offsetY={positionFor(pauta, index)} layer={layerFor(pauta, index)} reduceMotion={reduceMotion} onSelect={() => setSelected((current) => current === pauta.id ? null : pauta.id)} />)}
      <article className={`${styles.assetCard} ${styles.totalCard}`}><span className={styles.cardContent}><span className={styles.totalBalance}><span>{loading ? "consultando balance…" : error ? "balance no disponible" : visible.length ? "saldo total en plataformas" : "sin pautas activas"}</span><strong>{error ? "—" : formatAmount(total)}</strong>{!error && pendingTotal > 0 && <small className={styles.pendingTotal}>+ {formatAmount(pendingTotal)} en camino</small>}</span><Link href={`/${accountType}`}>{visible.length ? "recarga ahora" : "activar pauta"}</Link>
        {credit && <span className={styles.creditLine}>crédito disponible <b>{formatAmount(credit.creditAvailable)}</b> de <span>{formatAmount(credit.creditLimit)}</span> <span>· {credit.creditDays} días</span><small>{pendingTotal > 0 ? "Lo que está en camino se suma al saldo cuando lo acreditamos." : "El saldo de plataforma aumenta al completar una recarga."}</small></span>}
      </span></article>
    </section>
    {error && <LoadError className={styles.loadError} title="No pudimos cargar tus activos" message={error} frame="control" onRetry={retry} />}
  </></AccountShell>;
}
