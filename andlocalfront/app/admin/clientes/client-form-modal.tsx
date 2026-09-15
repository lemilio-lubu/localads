"use client";

import { FormEvent, useState } from "react";
import ActionButton from "../../components/action-button";
import ModalShell from "../../components/modal-shell";
import PlatformPill from "../../components/platform-pill";
import ToggleChip from "../../components/toggle-chip";
import { createAdminClient, updateAdminClient, type AdminClient, type AdminPlatform, type SaveAdminClient } from "../../lib/admin-clients-api";
import styles from "./client-form-modal.module.css";

type Props = { client: AdminClient | null; open: boolean; onClose: () => void; onSaved: (client: AdminClient) => void };
const allPlatforms: AdminPlatform[] = ["META", "GOOGLE", "TIKTOK"];

export default function ClientFormModal({ client, open, onClose, onSaved }: Props) {
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [accountType, setAccountType] = useState<SaveAdminClient["accountType"]>(client?.account.type ?? "PREPAGO");
  const [platforms, setPlatforms] = useState<AdminPlatform[]>(client?.account.platforms ?? ["META"]);
  const [creditDays, setCreditDays] = useState(client?.account.creditDays ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function togglePlatform(platform: AdminPlatform) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    const input = { name, email, accountType, platforms, creditDays: accountType === "PREPAGO" ? 0 : creditDays };
    try {
      const saved = client ? await updateAdminClient(client.id, { ...input, expectedPlatformsVersion: client.platformsVersion }) : await createAdminClient(input);
      onSaved(saved); onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar el cliente");
    } finally { setPending(false); }
  }

  return (
    <ModalShell open={open} labelledBy="client-form-title" className={styles.modal} onClose={onClose}>
      <h2 id="client-form-title">{client ? "editar cliente" : "crear nuevo cliente"}</h2>
      <form onSubmit={submit}>
        <label><span>nombre</span><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label>
        <label><span>correo</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label><span>tipo de cuenta</span>
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as SaveAdminClient["accountType"])}>
            <option value="PREPAGO">prepago</option><option value="POSTPAGO">postpago</option>
          </select>
        </label>
        {accountType === "POSTPAGO" && <label><span>días de crédito</span><input type="number" min="0" max="365" value={creditDays} onChange={(event) => setCreditDays(Number(event.target.value))} /></label>}
        <fieldset><legend>plataformas habilitadas</legend><div className={styles.platforms}>
          {allPlatforms.map((platform) => <ToggleChip key={platform} pressed={platforms.includes(platform)} onClick={() => togglePlatform(platform)}><PlatformPill platform={platform.toLowerCase() as "meta" | "google" | "tiktok"} /></ToggleChip>)}
        </div></fieldset>
        {client && <p>Al dar de baja una plataforma, sus recargas pendientes quedan en stop. Reactivarla conserva el saldo y requiere reanudar las recargas manualmente.</p>}
        <p className={styles.error} role="alert">{error}</p>
        <div className={styles.actions}><button type="button" onClick={onClose}>cancelar</button><ActionButton type="submit" disabled={pending}>{pending ? "guardando…" : "guardar cliente"}</ActionButton></div>
      </form>
    </ModalShell>
  );
}
