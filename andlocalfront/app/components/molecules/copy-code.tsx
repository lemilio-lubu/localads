"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./copy-code.module.css";

/* Un código que se copia al pulsarlo («copiar» → «copiado»). Copiar puede
   negarse (permiso, contexto inseguro, foco perdido): entonces lo dice y deja
   el código seleccionado para copiarlo a mano. El aviso dura 2,4 s.
   tone y size ajustan el texto al de cada lista; contained lo recorta al ancho
   de su celda (el detalle de factura). */
export default function CopyCode({ code, tone, size, mono = false, contained = false }: { code: string; tone?: "muted" | "strong"; size?: "body" | "small"; mono?: boolean; contained?: boolean }) {
  // Con el código guardado: si el botón pasa a mostrar otro, el aviso no se arrastra.
  const [copied, setCopied] = useState<{ code: string; ok: boolean } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(element: HTMLElement | null) {
    let ok = true;
    try { await navigator.clipboard.writeText(code); }
    catch { ok = false; if (element) window.getSelection()?.selectAllChildren(element); }
    setCopied({ code, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2400);
  }

  const state = copied?.code === code ? (copied.ok ? "done" : "failed") : undefined;
  return <button type="button" className={styles.copy} data-state={state} data-tone={tone} data-size={size} data-mono={mono || undefined} data-contained={contained || undefined} title={code} onClick={(event) => void copy(event.currentTarget.querySelector("span"))}>
    <span>{code}</span><small>{state === "done" ? "copiado" : state === "failed" ? "no se pudo" : "copiar"}</small>
  </button>;
}
