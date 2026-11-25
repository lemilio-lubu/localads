"use client";

import { BellOff, BellRing } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BrandLogo from "../../components/atoms/brand-logo";
import Button from "../../components/atoms/button";
import TextButton from "../../components/atoms/text-button";
import Checkbox from "../../components/molecules/checkbox";
import InlineNotice from "../../components/molecules/inline-notice";
import { enterTransition } from "../../design-system/motion";
import { getCurrentUser, refreshSession, type AuthUser } from "../../lib/auth-api";
import { getNotificationPreferences, setNotificationPreference, type NotificationChannel, type NotificationPreferences } from "../../lib/push-api";
import { currentPushState, disablePush, enablePush, isIosWithoutInstall, type PushDeviceState } from "../../lib/push-device";
import { landingFor } from "../../lib/recharges-api";
import styles from "./notification-settings.module.css";

const deviceText: Record<PushDeviceState, string> = {
  on: "Activados. Te llegan aunque no tengas la app abierta.",
  off: "Apagados. Los avisos solo se ven en la campana.",
  denied: "Bloqueados en el navegador. Para activarlos, permite las notificaciones de este sitio en los ajustes del navegador.",
  unsupported: "Este navegador no permite avisos fuera de la app.",
};

/** Pantalla «Avisos» de los tres roles: activar el push en este dispositivo
 *  y elegir qué tipos llegan por push y, lo crítico del cliente, por correo.
 *  La campana recibe todo siempre. */
export default function NotificationSettings() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [device, setDevice] = useState<PushDeviceState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [iosHint, setIosHint] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [loaded, state] = await Promise.all([getNotificationPreferences(), currentPushState()]);
      setPreferences(loaded); setDevice(state); setIosHint(state === "unsupported" && isIosWithoutInstall());
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "No fue posible cargar tus avisos");
    }
  }, []);

  /* Como «cambiar contraseña»: sin sesión, al login. */
  useEffect(() => {
    let active = true;
    const known = getCurrentUser();
    void (known ? Promise.resolve(known) : refreshSession()).then((current) => {
      if (!active) return;
      if (!current) { router.replace("/"); return; }
      /* Con la clave temporal el backend no deja hacer nada más. */
      if (current.mustChangePassword) { router.replace("/cambiar-contrasena"); return; }
      setUser(current);
      void load();
    });
    return () => { active = false; };
  }, [router, load]);

  async function toggleDevice() {
    if (!preferences?.publicKey || !device) return;
    setDeviceBusy(true); setDeviceError("");
    try {
      setDevice(device === "on" ? await disablePush() : await enablePush(preferences.publicKey));
    } catch (reason) {
      setDeviceError(reason instanceof Error ? reason.message : "No fue posible cambiar los avisos de este dispositivo");
    } finally {
      setDeviceBusy(false);
    }
  }

  /* Se guarda al marcar: la casilla cambia cuando el backend confirma. */
  async function toggleGroup(key: string, channel: NotificationChannel, enabled: boolean) {
    setSaving(`${key}:${channel}`); setSaveError("");
    try {
      await setNotificationPreference(key, channel, enabled);
      setPreferences((current) => current && { ...current, groups: current.groups.map((group) => (group.key === key ? { ...group, [channel]: enabled } : group)) });
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "No fue posible guardar la preferencia");
    } finally {
      setSaving(null);
    }
  }

  const pushReady = preferences?.pushAvailable === true;
  /* La columna de correo solo aparece si algún aviso del rol lo tiene (hoy, el cliente). */
  const hasEmail = preferences?.groups.some((group) => group.email !== null) === true;
  const canToggle = pushReady && (device === "on" || device === "off");

  return <main className={styles.page}>
    <motion.section className={styles.card} aria-labelledby="notifications-title"
      initial={reduceMotion ? false : { opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={reduceMotion ? { duration: 0 } : enterTransition}>
      <div className={styles.logo}><BrandLogo /></div>
      <div className={styles.heading}>
        <p>tu cuenta</p>
        <h1 id="notifications-title">avisos</h1>
        <span>La campana recibe todos tus avisos. Aquí eliges cuáles te llegan también fuera de la app.</span>
      </div>

      {loadError && <div className={styles.block}><InlineNotice onRetry={() => void load()}>{loadError}</InlineNotice></div>}
      {!loadError && !preferences && <p className={styles.loading} aria-busy="true">Cargando tus avisos…</p>}

      {preferences && device && <>
        <section className={styles.block} aria-labelledby="device-title">
          <h2 id="device-title">Este dispositivo</h2>
          <p className={styles.status} role="status">{pushReady ? deviceText[device] : "Los avisos en el dispositivo todavía no están disponibles."}</p>
          {iosHint && <p className={styles.hint}>En iPhone y iPad, primero instala la app con el botón «Instalar» y ábrela desde la pantalla de inicio.</p>}
          {canToggle && <Button variant={device === "on" ? "secondary" : "elevated"} onClick={() => void toggleDevice()} disabled={deviceBusy}>
            {device === "on" ? <BellOff size={16} aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}
            {deviceBusy ? "un momento…" : device === "on" ? "desactivar en este dispositivo" : "activar avisos en este dispositivo"}
          </Button>}
          {deviceError && <p className={styles.error} role="alert">{deviceError}</p>}
        </section>

        <section className={styles.block} aria-labelledby="types-title">
          <h2 id="types-title">Qué te avisamos</h2>
          <p className={styles.hint}>
            {hasEmail ? "Lo marcado en «dispositivo» te llega como notificación al celular o la computadora donde activaste los avisos. Por correo solo va lo importante, al correo de tu empresa." : "Lo marcado te llega como notificación al celular o la computadora donde activaste los avisos."}
            {hasEmail && !preferences.emailAvailable && " Los correos todavía no están activos: tu elección se guarda para cuando lo estén."}
          </p>
          <div className={`${styles.groups} ${hasEmail ? styles.withEmail : ""}`} role="group" aria-labelledby="types-title">
            {hasEmail && <div className={styles.columns} aria-hidden="true"><span /><span>dispositivo</span><span>correo</span></div>}
            {preferences.groups.map((group) => <div key={group.key} className={styles.groupRow}>
              <span className={styles.groupLabel}>{group.label}</span>
              <Checkbox checked={group.push} onChange={(enabled) => { if (!saving) void toggleGroup(group.key, "push", enabled); }} className={saving === `${group.key}:push` ? styles.saving : ""}>
                <span className={styles.srOnly}>{group.label}: en el dispositivo</span>
              </Checkbox>
              {hasEmail && (group.email === null
                ? <span aria-hidden="true" />
                : <Checkbox checked={group.email} onChange={(enabled) => { if (!saving) void toggleGroup(group.key, "email", enabled); }} className={saving === `${group.key}:email` ? styles.saving : ""}>
                  <span className={styles.srOnly}>{group.label}: por correo</span>
                </Checkbox>)}
            </div>)}
          </div>
          {saveError && <p className={styles.error} role="alert">{saveError}</p>}
        </section>
      </>}

      {user && <p className={styles.back}><TextButton size="body-sm" underline="hover" onClick={async () => router.push(await landingFor(user))}>volver</TextButton></p>}
    </motion.section>
  </main>;
}
