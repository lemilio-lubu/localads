"use client";

import { useCallback, useEffect, useState } from "react";
import { getPaymentAccount, type PaymentAccountResponse } from "./payment-account-api";

export type PaymentAccountState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PaymentAccountResponse };

/* La carga de la cuenta de cobro con sus estados: la usan la página de pago,
   la recarga prepago y el detalle de una recarga pospago. */
/* `enabled` evita la petición donde no se va a mostrar (el pospago no la usa al recargar). */
export function usePaymentAccount(enabled = true): [PaymentAccountState, () => void] {
  const [state, setState] = useState<PaymentAccountState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getPaymentAccount()
      .then((data) => { if (active) setState({ status: "ready", data }); })
      .catch((reason: unknown) => { if (active) setState({ status: "error", message: reason instanceof Error ? reason.message : "No fue posible cargar los datos de pago" }); });
    return () => { active = false; };
  }, [attempt, enabled]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }, []);
  return [state, retry];
}
