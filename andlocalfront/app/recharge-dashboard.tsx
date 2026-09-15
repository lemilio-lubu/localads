"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountShell from "./account-shell";
import ActionButton from "./components/action-button";
import ModalShell from "./components/modal-shell";
import { usePlatformUpdates } from "./lib/use-platform-updates";
import type { AccountType } from "./design-system/types";
import { accountContext, createActivationRequest, createPostpaidTransaction, createPrepaidTransaction, getActivationRequests, getMyPautas, type ActivationRequest, type PautaResponse, type RechargePlatform } from "./lib/recharges-api";
import styles from "./recharge-dashboard.module.css";

const platforms: Array<{ id: RechargePlatform; label: string; icon: string }> = [
  { id: "META", label: "Meta", icon: "/figma/meta.svg" },
  { id: "GOOGLE", label: "Google", icon: "/figma/google.svg" },
  { id: "TIKTOK", label: "TikTok", icon: "/figma/tiktok.svg" },
];

const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export default function RechargeDashboard({ accountType }: { accountType: AccountType }) {
  const revision = usePlatformUpdates();
  const mode = accountType === "prepago" ? "prepago" : "flex";
  const { clientId, accountId } = accountContext(mode);
  const isPrepaid = mode === "prepago";
  const [pautas, setPautas] = useState<PautaResponse[]>([]);
  const [requests, setRequests] = useState<ActivationRequest[]>([]);
  const [amounts, setAmounts] = useState<Record<RechargePlatform, string>>({ META: "", GOOGLE: "", TIKTOK: "" });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activationPlatform, setActivationPlatform] = useState<RechargePlatform | null>(null);
  const [activationError, setActivationError] = useState("");
  const [activation, setActivation] = useState({ requesterName: "", externalAccountId: "", phone: "", firstRechargeAmount: "" });
  const fileInput = useRef<HTMLInputElement>(null);
  const closeActivation = useCallback(() => { if (!submitting) setActivationPlatform(null); }, [submitting]);
  const selectedPlatform = platforms.find(({ id }) => id === activationPlatform);
  const reactivating = pautas.find((pauta) => pauta.platform === activationPlatform)?.status === "INACTIVE";
  const previousPautas = useRef<PautaResponse[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([getMyPautas(clientId), getActivationRequests(accountId)])
      .then(([nextPautas, nextRequests]) => { if (active) {
        const removed = previousPautas.current.some((old) => old.status === "ACTIVE" && !nextPautas.some((pauta) => pauta.id === old.id && pauta.status === "ACTIVE"));
        if (removed) { setAcceptedTerms(false); setMessage("Una plataforma fue desactivada. Revisa los montos antes de continuar."); }
        setAmounts((current) => Object.fromEntries(platforms.map(({ id }) => [id, nextPautas.some((pauta) => pauta.platform === id && pauta.status === "ACTIVE") ? current[id] : ""])) as Record<RechargePlatform, string>);
        previousPautas.current = nextPautas;
        setPautas(nextPautas); setRequests(nextRequests);
        setActivationPlatform((current) => nextPautas.some((pauta) => pauta.platform === current && pauta.status === "ACTIVE") ? null : current);
      } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar tus pautas"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, clientId, revision]);

  const activePautas = useMemo(() => new Map(pautas.filter((pauta) => pauta.status === "ACTIVE").map((pauta) => [pauta.platform, pauta])), [pautas]);
  const lines = platforms.flatMap(({ id }) => {
    const pauta = activePautas.get(id);
    const amount = Number(amounts[id]);
    return pauta && amount > 0 ? [{ pautaId: pauta.id, platform: id, amount }] : [];
  });
  const investment = lines.reduce((sum, item) => sum + item.amount, 0);
  const estimatedTotal = investment * 1.3225;
  const canSubmit = !loading && !submitting && acceptedTerms && lines.length > 0 && (!isPrepaid || receipt !== null);

  async function submitRecharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true); setError(""); setMessage("");
    try {
      const transaction = isPrepaid && receipt
        ? await createPrepaidTransaction(accountId, lines, receipt)
        : await createPostpaidTransaction(accountId, lines);
      setMessage(`Transacción ${transaction.code} creada con ${transaction.details.length} ${transaction.details.length === 1 ? "pauta" : "pautas"}. Pago ${transaction.payment.status.toLowerCase().replaceAll("_", " ")}.`);
      setAmounts({ META: "", GOOGLE: "", TIKTOK: "" }); setAcceptedTerms(false); setReceipt(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible procesar la recarga"); }
    finally { setSubmitting(false); }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activationPlatform || submitting) return;
    setSubmitting(true); setActivationError(""); setMessage("");
    try {
      const created = await createActivationRequest({ accountId, platform: activationPlatform, requesterName: activation.requesterName, externalAccountId: activation.externalAccountId, phone: activation.phone, firstRechargeAmount: Number(activation.firstRechargeAmount) });
      setRequests((current) => [created, ...current]);
      setMessage(`Solicitud de ${created.kind === "REACTIVATION" ? "reactivación" : "activación"} de ${activationPlatform} enviada. El administrador revisará tu solicitud.`);
      setActivationPlatform(null);
    } catch (reason) { setActivationError(reason instanceof Error ? reason.message : "No fue posible solicitar la activación"); }
    finally { setSubmitting(false); }
  }

  function selectReceipt(event: ChangeEvent<HTMLInputElement>) { setReceipt(event.target.files?.[0] ?? null); setError(""); setMessage(""); }
  function openRequest(platform: RechargePlatform) { return requests.find((request) => request.platform === platform && ["PENDING", "IN_REVIEW"].includes(request.status)); }

  return (
    <AccountShell accountType={accountType} activePage="recharge">
      <section className={`${styles.rechargePanel} ${isPrepaid ? styles.prepaidPanel : ""}`} aria-labelledby="recharge-title">
        <header className={styles.heading}>
          <h1 id="recharge-title">sistema de recargas</h1>
          {investment > 0 && <div className={styles.summary}><span>Inversión {money.format(investment)}</span><strong>Total estimado {money.format(estimatedTotal)}</strong></div>}
        </header>

        <form onSubmit={submitRecharge} className={styles.form}>
          <div className={styles.fields} aria-busy={loading}>
            {platforms.map(({ id, label, icon }) => {
              const pauta = activePautas.get(id);
              const pending = openRequest(id);
              const existing = pautas.find((item) => item.platform === id);
              const requiresReview = existing && ["SUSPENDED", "PENDING_ACTIVATION"].includes(existing.status);
              if (!pauta) return (
                <button key={id} type="button" className={`${styles.activationButton} ${styles[id.toLowerCase()]}`} disabled={Boolean(pending) || Boolean(requiresReview) || loading} aria-haspopup="dialog" onClick={() => { setActivationError(""); setActivation({ requesterName: "", externalAccountId: existing?.externalAccountId ?? "", phone: "", firstRechargeAmount: "" }); setActivationPlatform(id); }}>
                  <Image src={icon} alt="" width={28} height={28} /><span>{loading ? `Cargando ${label}…` : pending ? `${label}: ${pending.kind === "REACTIVATION" ? "reactivación" : "activación"} ${pending.status === "PENDING" ? "pendiente" : "en revisión"}` : requiresReview ? `${label}: requiere revisión administrativa` : existing?.status === "INACTIVE" ? `solicitar reactivación de ${label.toLowerCase()}` : `desbloquea ${label.toLowerCase()} local ads`}</span>
                </button>
              );
              return (
                <label key={id} className={styles.platformField} htmlFor={`${id}-amount`}>
                  <Image src={id === "TIKTOK" ? "/figma/tiktok-modal.svg" : icon} alt="" width={30} height={30} /><span className={styles.currency}>$</span>
                  <input id={`${id}-amount`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="500" value={amounts[id]} onChange={(event) => { setAmounts((current) => ({ ...current, [id]: event.target.value })); setMessage(""); setError(""); }} aria-label={`Monto para ${label}`} />
                </label>
              );
            })}
          </div>

          {isPrepaid && <button type="button" className={`${styles.uploadArea} ${receipt ? styles.hasReceipt : ""}`} onClick={() => fileInput.current?.click()}>
            <input ref={fileInput} type="file" accept="image/*,.pdf" onChange={selectReceipt} tabIndex={-1} />
            <Image src="/figma/attachment.svg" alt="" width={36} height={36} /><span>{receipt?.name ?? "adjuntar comprobante"}</span>
          </button>}

          <label className={styles.terms}><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span className={styles.checkbox} aria-hidden="true"><Image src="/figma/check.svg" alt="" width={19} height={19} /></span><span>He leído términos y condiciones</span></label>
          <ActionButton className={styles.submitButton} type="submit" disabled={!canSubmit}>{submitting ? "Procesando…" : "recargar"}</ActionButton>
          <p className={`${styles.formStatus} ${error ? styles.error : ""}`} role={error ? "alert" : "status"} aria-live="polite">{loading ? "Cargando pautas…" : error || message}</p>
        </form>

        <ModalShell open={Boolean(activationPlatform)} labelledBy="activation-title" className={`${styles.activationModal} ${activationPlatform ? styles[activationPlatform.toLowerCase()] : ""}`} onClose={closeActivation}>
          {selectedPlatform && <form className={styles.activationPanel} onSubmit={submitActivation} aria-busy={submitting}>
            <header className={styles.activationHeading}>
              <Image src={activationPlatform === "TIKTOK" ? "/figma/tiktok-modal.svg" : selectedPlatform.icon} alt="" width={37} height={43} />
              <h2 id="activation-title">{reactivating ? "Reactiva" : "Solicita"} Local Ads para {selectedPlatform.label}</h2>
            </header>
            <p className={styles.activationDescription}>{reactivating ? <>Solicita volver a activar tu plataforma. Conservas tu saldo e historial.<br />Las recargas en stop deberán ser reanudadas manualmente por el administrador.</> : <>Una gran oportunidad para pautar en {selectedPlatform.label} con factura local en Ecuador.<br />Optimiza tu inversión publicitaria y aprovecha sus beneficios tributarios con Local Ads.</>}</p>
            <label><input required autoComplete="name" minLength={2} disabled={submitting} value={activation.requesterName} onChange={(e) => setActivation((v) => ({ ...v, requesterName: e.target.value }))} /><span>nombre de la persona solicitante</span></label>
            <label><input required disabled={submitting} readOnly={reactivating && Boolean(pautas.find((pauta) => pauta.platform === activationPlatform)?.externalAccountId)} value={activation.externalAccountId} onChange={(e) => setActivation((v) => ({ ...v, externalAccountId: e.target.value }))} /><span>ID de la cuenta de {selectedPlatform.label}</span></label>
            <label><input required type="number" inputMode="decimal" min="0.01" step="0.01" disabled={submitting} value={activation.firstRechargeAmount} onChange={(e) => setActivation((v) => ({ ...v, firstRechargeAmount: e.target.value }))} /><span>{reactivating ? "monto de referencia para la próxima recarga" : "monto de la primera recarga"}</span></label>
            <label><input required type="tel" autoComplete="tel" disabled={submitting} value={activation.phone} onChange={(e) => setActivation((v) => ({ ...v, phone: e.target.value }))} /><span>número de teléfono</span></label>
            <div className={styles.activationActions}><ActionButton className={styles.activationSubmit} type="submit" disabled={submitting}>{submitting ? "Enviando…" : reactivating ? "solicitar reactivación" : "solicitar la cuenta"}</ActionButton></div>
            {activationError && <p className={styles.activationError} role="alert">{activationError}</p>}
          </form>}
        </ModalShell>
      </section>
    </AccountShell>
  );
}
