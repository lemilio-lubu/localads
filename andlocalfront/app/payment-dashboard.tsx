"use client";

import AccountShell from "./account-shell";
import PaymentAccountPanel from "./components/payment-account-panel";
import type { AccountType } from "./design-system/types";
import styles from "./payment-dashboard.module.css";

/* Los datos de pago siempre a mano, no solo en el momento de recargar: el
   cliente que cierra la pestaña, o que paga horas después desde el banco,
   vuelve aquí. La cuenta es la misma para todos; lo que cambia es cuándo se
   paga, y eso lo dice el texto de cada tipo de cuenta. */
export default function PaymentDashboard({ accountType }: { accountType: AccountType }) {
  const prepaid = accountType === "prepago";
  return (
    <AccountShell accountType={accountType} activePage="payment">
      <section className={styles.page} aria-labelledby="payment-heading">
        <div className={styles.intro}>
          <h1 id="payment-heading">cómo pagar</h1>
          <p>
            {prepaid
              ? "Transfiere el total de tu recarga a esta cuenta y adjunta el comprobante al pedirla. Ponemos tu referencia en el concepto para reconocer tu pago."
              : "Paga cada recarga antes de su vencimiento transfiriendo a esta cuenta. Sube el comprobante desde el detalle de la recarga, en tus facturas."}
          </p>
        </div>
        <PaymentAccountPanel detailed />
      </section>
    </AccountShell>
  );
}
