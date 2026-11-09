"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./overflow-tooltip.module.css";

/* Tooltip para el texto libre que se recorta con «…» (correo, razón social,
   gestor, nombre de archivo). Se monta una vez en el layout y sirve a toda la
   app: no hace falta marcar nada, basta con que el texto se recorte con
   `text-overflow: ellipsis` o con `-webkit-line-clamp`.

   Existe porque `title` no llegaba a verse en las listas: el botón que abre el
   detalle (RowOpener) cubre la fila entera y el ratón nunca toca el texto. Por
   eso, cuando el puntero está sobre ese botón, se busca debajo el texto
   recortado que contiene el punto.

   Solo con ratón: en táctil no hay hover y tocar la fila abre el detalle, que
   ya enseña el valor completo. El texto completo sigue en el DOM, así que los
   lectores de pantalla lo leen entero; el tooltip es solo visual. */

type Tip = { text: string; anchor: DOMRect };

const SHOW_DELAY_MS = 350;

function isTruncated(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.textContent?.trim()) return false;
  const style = getComputedStyle(element);
  if (style.textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth + 1) return true;
  const clamp = style.getPropertyValue("-webkit-line-clamp");
  return Boolean(clamp) && clamp !== "none" && element.scrollHeight > element.clientHeight + 1;
}

/* Un `title` propio ya muestra su tooltip nativo cuando el ratón lo alcanza:
   no se duplica. */
function hasOwnTitle(element: Element) {
  return element.hasAttribute("title");
}

function contains(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function findTruncated(hit: Element, x: number, y: number): HTMLElement | null {
  if (hit.closest("[title]")) return null;
  /* Debajo del botón de la fila: el texto recortado que contiene el punto. */
  const opener = hit.closest("[data-row-opener]");
  if (opener?.parentElement) {
    const under = [...opener.parentElement.querySelectorAll("*")].filter((element) => element !== opener && contains(element.getBoundingClientRect(), x, y));
    for (let index = under.length - 1; index >= 0; index -= 1) {
      const element = under[index];
      if (isTruncated(element) && !hasOwnTitle(element)) return element;
    }
    return null;
  }
  /* Sin botón encima: el propio elemento o uno de sus padres cercanos. */
  let element: Element | null = hit;
  for (let depth = 0; element && depth < 4; depth += 1, element = element.parentElement) {
    if (isTruncated(element)) return element;
  }
  return null;
}

export default function OverflowTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const tipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    function hide() {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    }

    function show(element: HTMLElement) {
      setTip({ text: element.textContent?.trim() ?? "", anchor: element.getBoundingClientRect() });
    }

    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const { clientX: x, clientY: y } = event;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const hit = document.elementFromPoint(x, y);
        const target = hit ? findTruncated(hit, x, y) : null;
        if (target === current.current) return;
        const warm = current.current !== null;
        window.clearTimeout(timer.current);
        current.current = target;
        if (!target) { setTip(null); return; }
        /* Pasando de un recorte a otro el tooltip cambia al instante, como
           los nativos; el primero espera un poco para no parpadear. */
        if (warm) show(target);
        else timer.current = window.setTimeout(() => { if (current.current === target) show(target); }, SHOW_DELAY_MS);
      });
    }

    function onKey(event: KeyboardEvent) { if (event.key === "Escape") hide(); }

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", hide, { passive: true });
    document.addEventListener("keydown", onKey);
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer.current);
      if (frame.current) cancelAnimationFrame(frame.current);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", onKey);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("blur", hide);
    };
  }, []);

  /* Encima del texto y alineado con su borde izquierdo; debajo si arriba no
     cabe, y siempre dentro de la pantalla. */
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setPosition(null); return; }
    const gutter = 8;
    const box = tipRef.current.getBoundingClientRect();
    const fitsAbove = tip.anchor.top - box.height - gutter >= gutter;
    const top = fitsAbove ? tip.anchor.top - box.height - gutter : tip.anchor.bottom + gutter;
    const left = Math.min(Math.max(tip.anchor.left, gutter), document.documentElement.clientWidth - box.width - gutter);
    setPosition({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={tipRef} className={styles.tooltip} role="presentation" aria-hidden="true" data-ready={position ? "" : undefined} style={position ?? undefined}>
      {tip.text}
    </div>,
    document.body,
  );
}
