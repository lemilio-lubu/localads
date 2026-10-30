"use client";

import { type ReactNode } from "react";
import { maskedAccountNumber, paymentAccountText } from "../lib/payment-account-api";
import { usePaymentAccount, type PaymentAccountState } from "../lib/use-payment-account";
import PaymentAccountCard from "./payment-account-card";
import styles from "./payment-account-panel.module.css";

/* La cuenta de cobro con sus cuatro estados: cargando, error, sin configurar y
   con datos. Se usa donde el cliente va a pagar (recargar, detalle de una
   recarga, la página de pago), siempre con la misma tarjeta. */
type ViewOptions = { note?: ReactNode; compact?: boolean; amount?: number | null; detailed?: boolean };

export default function PaymentAccountPanel({ note, compact, amount, detailed }: ViewOptions) {
  const [state, retry] = usePaymentAccount();
  return <PaymentAccountView state={state} retry={retry} note={note} compact={compact} amount={amount} detailed={detailed} />;
}

/* Lo mismo con el estado ya cargado, para quien además necesita los datos
   (la recarga los usa en el resumen de confirmación) y no quiere pedirlos dos veces. */
export function PaymentAccountView({ state, retry, note, compact, amount, detailed }: ViewOptions & { state: PaymentAccountState; retry: () => void }) {
  if (state.status === "loading") return <div className={styles.skeleton} role="status" aria-label="Cargando los datos de pago" />;
  if (state.status === "error") {
    return <p className={styles.message} role="alert">{state.message} <button type="button" onClick={retry}>reintentar</button></p>;
  }
  const { account, reference } = state.data;
  if (!account) {
    return <p className={styles.message} role="status">Aún no hay una cuenta de pago configurada. Escríbenos y te indicamos a dónde transferir.</p>;
  }
  return <PaymentAccountCard account={account} reference={reference} copyAllText={paymentAccountText(account, reference)} note={note} compact={compact} amount={amount} detailed={detailed} />;
}

/* «Produbanco ••••5407», para confirmar a dónde se transfiere sin repetir todo el bloque. */
export function paymentDestinationLabel(account: { bankName: string; accountNumber: string } | null | undefined) {
  return account ? `${account.bankName} ${maskedAccountNumber(account.accountNumber)}` : null;
}
