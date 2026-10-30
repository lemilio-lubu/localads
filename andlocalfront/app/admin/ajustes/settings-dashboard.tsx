"use client";

import { Banknote, CreditCard, Hash, IdCard, Landmark, Mail, Phone, UserRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import ActionButton from "../../components/action-button";
import { FormError, FormField as Field, formStyles as form } from "../../components/form-modal";
import PaymentAccountCard from "../../components/payment-account-card";
import { getCurrentUser } from "../../lib/auth-api";
import { formatDateTime } from "../../lib/format";
import {
  getPaymentAccount, getPaymentAccountHistory, paymentAccountText, savePaymentAccount,
  type PaymentAccount, type PaymentAccountChange, type PaymentAccountInput,
} from "../../lib/payment-account-api";
import styles from "./settings-dashboard.module.css";

const emptyForm: PaymentAccountInput = { bankName: "", accountType: "", accountNumber: "", holderName: "", holderTaxId: "", email: "", phone: "" };
const labels: Record<keyof Omit<PaymentAccount, "id" | "updatedAt" | "updatedById">, string> = {
  bankName: "banco", accountType: "tipo de cuenta", accountNumber: "número de cuenta", holderName: "titular", holderTaxId: "RUC", email: "correo", phone: "celular",
};

const toForm = (account: PaymentAccount): PaymentAccountInput => ({
  bankName: account.bankName, accountType: account.accountType, accountNumber: account.accountNumber,
  holderName: account.holderName, holderTaxId: account.holderTaxId, email: account.email ?? "", phone: account.phone ?? "",
});

/* Qué cambió en una entrada del historial: los nombres de los campos, no sus
   valores. El detalle completo está en el antes y el después guardados. */
function changedFields(change: PaymentAccountChange) {
  if (!change.before) return "Se configuró la cuenta de cobro";
  const keys = (Object.keys(labels) as (keyof typeof labels)[]).filter((key) => (change.before?.[key] ?? null) !== (change.after[key] ?? null));
  return keys.length ? `Cambió ${keys.map((key) => labels[key]).join(", ")}` : "Se guardó sin cambios";
}

/* Cambiar a dónde pagan los clientes es cosa del admin (el backend lo exige
   por rol). El gestor ve la cuenta para poder orientar a un cliente, sin
   formulario. Guardar pide una confirmación aparte: es la acción que desvía
   dinero si se hace mal. */
export default function SettingsDashboard() {
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [history, setHistory] = useState<PaymentAccountChange[]>([]);
  const [values, setValues] = useState<PaymentAccountInput>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const requestSettings = useCallback(() => Promise.all([getPaymentAccount(), isAdmin ? getPaymentAccountHistory() : Promise.resolve([])]), [isAdmin]);
  const apply = ([current, changes]: Awaited<ReturnType<typeof requestSettings>>) => {
    setAccount(current.account);
    setHistory(changes);
    setValues(current.account ? toForm(current.account) : emptyForm);
  };

  useEffect(() => {
    let active = true;
    requestSettings()
      .then((data) => { if (active) apply(data); })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : "No fue posible cargar la cuenta de cobro"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // apply solo usa setters estables: no debe reiniciar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSettings, attempt]);

  const retry = () => { setLoading(true); setLoadError(""); setAttempt((value) => value + 1); };

  const set = (key: keyof PaymentAccountInput) => (value: string) => { setValues((current) => ({ ...current, [key]: value })); setSaved(false); setSaveError(""); setConfirming(false); };
  const unchanged = account !== null && JSON.stringify(values) === JSON.stringify(toForm(account));
  const complete = [values.bankName, values.accountType, values.accountNumber, values.holderName, values.holderTaxId].every((value) => value.trim().length > 0);

  function review(event: FormEvent) { event.preventDefault(); if (complete && !unchanged) setConfirming(true); }

  async function save() {
    setSaving(true); setSaveError("");
    try {
      await savePaymentAccount(values);
      setConfirming(false); setSaved(true);
      apply(await requestSettings());
    } catch (reason) {
      setConfirming(false);
      setSaveError(reason instanceof Error ? reason.message : "No fue posible guardar la cuenta de cobro");
    } finally { setSaving(false); }
  }

  if (loading) return <div className={styles.skeleton} role="status" aria-label="Cargando la cuenta de cobro" />;
  if (loadError) return <p className={styles.message} role="alert">{loadError} <button type="button" onClick={retry}>reintentar</button></p>;

  const preview = {
    bankName: values.bankName.trim() || "Banco", accountType: values.accountType.trim() || "Tipo de cuenta",
    accountNumber: values.accountNumber.trim() || "0000000000", holderName: values.holderName.trim() || "Titular", holderTaxId: values.holderTaxId.trim() || "0000000000000",
    email: values.email?.trim() || null, phone: values.phone?.trim() || null,
  };

  return (
    <div className={styles.page}>
      <p className={styles.intro}>{isAdmin
        ? "La cuenta a la que transfieren los clientes. Los cambios se aplican de inmediato."
        : "La cuenta a la que transfieren los clientes. Solo un administrador puede cambiarla."}</p>

      {!isAdmin && (account
        ? <PaymentAccountCard detailed account={account} copyAllText={paymentAccountText(account, null)} note="Cada cliente ve además su propia referencia, que escribe en el concepto de la transferencia." />
        : <p className={styles.message} role="status">Aún no hay una cuenta de cobro configurada.</p>)}

      {isAdmin && (
        <form className={`${form.form} ${styles.form}`} onSubmit={review} noValidate aria-label="Cuenta de cobro">
          <div className={form.section}>
            <div className={form.grid}>
              <Field label="Banco" Icon={Landmark}>{({ id, describedBy, invalid }) => <input id={id} value={values.bankName} maxLength={80} onChange={(event) => set("bankName")(event.target.value)} placeholder="Produbanco" aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
              <Field label="Tipo de cuenta" Icon={CreditCard}>{({ id, describedBy, invalid }) => <input id={id} value={values.accountType} maxLength={60} onChange={(event) => set("accountType")(event.target.value)} placeholder="Cuenta Pro Pyme" aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
              <Field label="Número de cuenta" Icon={Hash}>{({ id, describedBy, invalid }) => <input id={id} className={styles.digits} inputMode="numeric" value={values.accountNumber} maxLength={40} onChange={(event) => set("accountNumber")(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
              <Field label="RUC / identificación" Icon={IdCard}>{({ id, describedBy, invalid }) => <input id={id} className={styles.digits} inputMode="numeric" value={values.holderTaxId} maxLength={20} onChange={(event) => set("holderTaxId")(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
              <Field className={form.wide} label="Titular" Icon={UserRound}>{({ id, describedBy, invalid }) => <input id={id} value={values.holderName} maxLength={120} onChange={(event) => set("holderName")(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
            </div>
            <fieldset className={styles.optional}>
              <legend>Contacto (opcional)</legend>
              <div className={form.grid}>
                <Field label="Correo" Icon={Mail}>{({ id, describedBy, invalid }) => <input id={id} type="email" value={values.email} maxLength={120} onChange={(event) => set("email")(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
                <Field label="Celular" Icon={Phone}>{({ id, describedBy, invalid }) => <input id={id} type="tel" inputMode="tel" value={values.phone} maxLength={30} onChange={(event) => set("phone")(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}</Field>
              </div>
            </fieldset>
          </div>

          <FormError message={saveError} />
          {saved && <p className={styles.success} role="status">Cuenta guardada. Los clientes ya ven los datos nuevos.</p>}

          {confirming
            ? <div className={styles.confirm} role="alertdialog" aria-labelledby="confirm-payment-account">
                <p id="confirm-payment-account"><Banknote size={18} aria-hidden="true" /><span><strong>Esto es lo que verán los clientes, de inmediato.</strong> Comprueba el número y el titular: un dato mal puesto desvía pagos reales.</span></p>
                <PaymentAccountCard quiet account={preview} />
                <div><button type="button" className={styles.cancel} onClick={() => setConfirming(false)} disabled={saving}>Revisar de nuevo</button><ActionButton type="button" disabled={saving} onClick={() => void save()}>{saving ? "Guardando…" : "Sí, guardar"}</ActionButton></div>
              </div>
            : <ActionButton type="submit" disabled={!complete || unchanged}>{account ? "Guardar cambios" : "Guardar cuenta"}</ActionButton>}
        </form>
      )}

      {isAdmin && (
        <section className={styles.history} aria-labelledby="payment-history-heading">
          <h3 id="payment-history-heading">últimos cambios</h3>
          {history.length === 0
            ? <p className={styles.empty}>Todavía no hay cambios registrados.</p>
            : <ol>{history.map((change) => <li key={change.id}><strong>{changedFields(change)}</strong><span>{change.changedByName ?? "usuario eliminado"} · {formatDateTime(change.createdAt)}</span></li>)}</ol>}
        </section>
      )}
    </div>
  );
}
