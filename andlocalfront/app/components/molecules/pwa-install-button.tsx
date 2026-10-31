"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./pwa-install-button.module.css";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let appWasInstalled = false;
const installedStorageKey = "andlocal-pwa-installed";

function subscribeInstallStatus(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const handleInstalled = () => markInstalled();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === installedStorageKey) onChange();
  };
  displayMode.addEventListener("change", onChange);
  window.addEventListener("appinstalled", handleInstalled);
  window.addEventListener("and-pwa-installed", onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    displayMode.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", handleInstalled);
    window.removeEventListener("and-pwa-installed", onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function markInstalled() {
  appWasInstalled = true;
  try {
    window.localStorage.setItem(installedStorageKey, "true");
  } catch {
    // The in-memory state still hides the button if storage is unavailable.
  }
  window.dispatchEvent(new Event("and-pwa-installed"));
}

function getInstallStatus() {
  let wasInstalled = false;
  try {
    wasInstalled = window.localStorage.getItem(installedStorageKey) === "true";
  } catch {
    // Standalone mode and the appinstalled event remain available.
  }
  return appWasInstalled || wasInstalled || window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

export default function PwaInstallButton({ className = "" }: { className?: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(subscribeInstallStatus, getInstallStatus, () => false);
  const [showHelp, setShowHelp] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (showHelp && !dialog.open) dialog.showModal();
    if (!showHelp && dialog.open) dialog.close();
  }, [showHelp]);

  useEffect(() => {
    if (installed) markInstalled();
  }, [installed]);

  async function install() {
    if (!installPrompt) {
      setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
      setShowHelp(true);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled();
        setShowHelp(false);
      }
    } catch {
      setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
      setShowHelp(true);
    }
    setInstallPrompt(null);
  }

  if (installed) return null;

  return <>
    <button type="button" className={`${styles.trigger} ${className}`} onClick={() => void install()}>
      <Download size={16} aria-hidden="true" />
      <span>Instalar</span>
    </button>
    {showHelp && <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="pwa-install-title" onCancel={() => setShowHelp(false)}>
      <header className={styles.dialogHeader}>
        <div><span className={styles.eyebrow}>AND Local Ads</span><h2 id="pwa-install-title">Instala la app</h2></div>
        <button type="button" className={styles.close} onClick={() => setShowHelp(false)} aria-label="Cerrar"><X size={18} /></button>
      </header>
      {isIOS ? <ol className={styles.steps}>
        <li><span>1</span><p>Toca <b>Compartir</b> <Share size={15} aria-hidden="true" /> en Safari.</p></li>
        <li><span>2</span><p>Elige <b>Añadir a pantalla de inicio</b> y confirma.</p></li>
      </ol> : <p className={styles.helpText}>Abre el menú de tu navegador y elige <b>Instalar app</b> o <b>Añadir a pantalla principal</b>.</p>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.done} onClick={() => setShowHelp(false)}>Cerrar</button>
        <button type="button" className={styles.done} onClick={() => { markInstalled(); setShowHelp(false); }}>Ya la instalé</button>
      </div>
    </dialog>}
  </>;
}
