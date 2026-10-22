"use client";

import { Download, Maximize, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchAuthenticatedFile } from "../lib/auth-api";
import styles from "./file-viewer.module.css";

/* Visor de comprobantes y facturas dentro de la aplicación, en vez de una
   pestaña nueva. Las imágenes se acercan (botones, rueda, pellizco, doble
   clic), se arrastran y se giran; los PDF usan el visor del navegador, que ya
   trae zoom y páginas.

   Va en un portal sobre body: el modal de detalle tiene transform y un
   position: fixed dentro de él quedaría anclado al modal, no a la ventana. */

export type ViewerFile = { url: string; name: string };
type View = { scale: number; x: number; y: number; rotation: number };

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const STEP = 1.5;
const FIT: View = { scale: 1, x: 0, y: 0, rotation: 0 };

export default function FileViewer({ file, onClose }: { file: ViewerFile | null; onClose: () => void }) {
  if (!file || typeof document === "undefined") return null;
  return createPortal(<Viewer key={file.url} file={file} onClose={onClose} />, document.body);
}

function Viewer({ file, onClose }: { file: ViewerFile; onClose: () => void }) {
  const [blob, setBlob] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>(FIT);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; scale: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    fetchAuthenticatedFile(file.url)
      .then((content) => { if (!active) return; objectUrl = URL.createObjectURL(content); setBlob({ url: objectUrl, type: content.type }); })
      .catch(() => { if (active) setError("No pudimos abrir el archivo."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.url, attempt]);

  /* Mantiene la imagen a la vista: sin límite, un arrastre la sacaba entera
     de la pantalla. Con el giro de 90° el ancho y el alto se intercambian. */
  const clamp = useCallback((next: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
    const img = image.current; const box = stage.current;
    if (!img || !box || scale === MIN_SCALE) return { ...next, scale, x: 0, y: 0 };
    const turned = next.rotation % 180 !== 0;
    const width = (turned ? img.offsetHeight : img.offsetWidth) * scale;
    const height = (turned ? img.offsetWidth : img.offsetHeight) * scale;
    const maxX = Math.max(0, (width - box.clientWidth) / 2);
    const maxY = Math.max(0, (height - box.clientHeight) / 2);
    return { ...next, scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }, []);

  /* Acerca hacia un punto (cursor, centro del pellizco): ese punto se queda
     quieto bajo el dedo en vez de escaparse hacia el centro. */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setView((current) => {
      const box = stage.current?.getBoundingClientRect();
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const px = box && clientX !== undefined ? clientX - (box.left + box.width / 2) : 0;
      const py = box && clientY !== undefined ? clientY - (box.top + box.height / 2) : 0;
      const ratio = scale / current.scale;
      return clamp({ ...current, scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
    });
  }, [clamp]);

  const isImage = blob?.type.startsWith("image/") ?? false;
  const isPdf = blob?.type === "application/pdf";

  /* Teclado: Escape cierra solo el visor (captura y corta, si no cerraría
     también el detalle de debajo); +, -, 0 y flechas para la imagen; Tab
     queda dentro del visor. */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.stopImmediatePropagation(); event.preventDefault(); onCloseRef.current(); return; }
      if (event.key === "Tab") {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), iframe");
        if (!focusable?.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopImmediatePropagation(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopImmediatePropagation(); first.focus(); }
        else event.stopImmediatePropagation();
        return;
      }
      if (!image.current) return;
      const pan = 60;
      const moves: Record<string, () => void> = {
        "+": () => zoomAt(STEP), "=": () => zoomAt(STEP), "-": () => zoomAt(1 / STEP), "0": () => setView(FIT),
        ArrowLeft: () => setView((v) => clamp({ ...v, x: v.x + pan })), ArrowRight: () => setView((v) => clamp({ ...v, x: v.x - pan })),
        ArrowUp: () => setView((v) => clamp({ ...v, y: v.y + pan })), ArrowDown: () => setView((v) => clamp({ ...v, y: v.y - pan })),
      };
      const move = moves[event.key];
      if (move) { event.preventDefault(); event.stopImmediatePropagation(); move(); }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => { window.removeEventListener("keydown", onKeyDown, { capture: true }); document.body.style.overflow = previousOverflow; returnFocus?.focus(); };
  }, [clamp, zoomAt]);

  /* La rueda necesita un listener no pasivo para impedir el scroll; el
     pellizco del trackpad llega como rueda con ctrlKey y se trata igual. */
  useEffect(() => {
    const box = stage.current;
    if (!box || !isImage) return;
    function onWheel(event: WheelEvent) { event.preventDefault(); zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), event.clientX, event.clientY); }
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [isImage, zoomAt]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isImage) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const target = gesture.current.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.current.distance;
      zoomAt(target / view.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.current.size === 1 && view.scale > MIN_SCALE) {
      setView((current) => clamp({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  }

  const percent = Math.round(view.scale * 100);
  return <div ref={dialog} className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Visor de ${file.name}`}>
    <header className={styles.toolbar}>
      <strong className={styles.name} title={file.name}>{file.name}</strong>
      <div className={styles.tools}>
        {isImage && <>
          <button type="button" onClick={() => zoomAt(1 / STEP)} disabled={view.scale <= MIN_SCALE} aria-label="Alejar" title="Alejar (−)"><ZoomOut aria-hidden="true" /></button>
          <span className={styles.percent} aria-live="polite">{percent}%</span>
          <button type="button" onClick={() => zoomAt(STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Acercar" title="Acercar (+)"><ZoomIn aria-hidden="true" /></button>
          <button type="button" onClick={() => setView((current) => clamp({ ...current, rotation: (current.rotation + 90) % 360 }))} aria-label="Girar" title="Girar"><RotateCw aria-hidden="true" /></button>
          <button type="button" onClick={() => setView(FIT)} disabled={view.scale === 1 && view.rotation === 0} aria-label="Ajustar a la pantalla" title="Ajustar (0)"><Maximize aria-hidden="true" /></button>
        </>}
        {blob && <a href={blob.url} download={file.name} aria-label="Descargar" title="Descargar"><Download aria-hidden="true" /></a>}
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Cerrar visor" title="Cerrar (Esc)"><X aria-hidden="true" /></button>
      </div>
    </header>
    <div
      ref={stage}
      className={styles.stage}
      data-zoomed={view.scale > MIN_SCALE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => { if (isImage) { if (view.scale > MIN_SCALE) setView((current) => ({ ...FIT, rotation: current.rotation })); else zoomAt(2.5, event.clientX, event.clientY); } }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && view.scale === MIN_SCALE) onClose(); }}
    >
      {!blob && !error && <p className={styles.status}>Cargando archivo…</p>}
      {error && <div className={styles.status} role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>reintentar</button></div>}
      {/* eslint-disable-next-line @next/next/no-img-element -- blob local: next/image no lo optimiza */}
      {blob && isImage && <img ref={image} src={blob.url} alt={file.name} draggable={false} style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale}) rotate(${view.rotation}deg)` }} />}
      {blob && isPdf && <iframe src={blob.url} title={file.name} className={styles.pdf} />}
      {blob && !isImage && !isPdf && <div className={styles.status}><p>Este archivo no se puede previsualizar.</p><a href={blob.url} download={file.name}>descargar</a></div>}
    </div>
  </div>;
}
