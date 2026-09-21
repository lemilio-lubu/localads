"use client";

import { FormEvent, useEffect, useState } from "react";
import ActionButton from "../../components/action-button";
import ModalShell from "../../components/modal-shell";
import PlatformPill from "../../components/platform-pill";
import ToggleChip from "../../components/toggle-chip";
import { createAdminClient, updateAdminClient, type AdminClient, type AdminClientWithCredentials, type AdminPlatform, type SaveAdminClient } from "../../lib/admin-clients-api";
import { assignClientManager, getTeam, type TeamMember } from "../../lib/team-api";
import { validateClientProfile } from "../../lib/form-validation";
import styles from "./client-form-modal.module.css";

type Props = {
  client: AdminClient | null;
  open: boolean;
  /* Solo el admin elige gestor. Un gestor se asigna a sí mismo y el backend lo
     toma del token, así que el selector le sobra y se le oculta. */
  isAdmin?: boolean;
  onClose: () => void;
  onSaved: (client: AdminClient) => void;
  onCreated?: (client: AdminClientWithCredentials) => void;
};
const allPlatforms: AdminPlatform[] = ["META", "GOOGLE", "TIKTOK"];

export default function ClientFormModal({ client, open, isAdmin = false, onClose, onSaved, onCreated }: Props) {
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [accountType, setAccountType] = useState<SaveAdminClient["accountType"]>(client?.account.type ?? "PREPAGO");
  const [platforms, setPlatforms] = useState<AdminPlatform[]>(client?.account.platforms ?? ["META"]);
  // Una cuenta postpago necesita al menos un dia de credito (BR-029), asi que
  // el valor inicial es valido y el campo no admite cero.
  const [creditDays, setCreditDays] = useState(client?.account.creditDays || 30);
  const [managerId, setManagerId] = useState(client?.manager?.id ?? "");
  const [managers, setManagers] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  /* La lista de gestores se pide solo cuando el selector va a verse; si falla,
     el formulario sigue siendo usable sin asignar gestor. */
  useEffect(() => {
    if (!open || !isAdmin) return;
    let active = true;
    getTeam({ role: "GESTOR", status: "ACTIVE" }).then((team) => { if (active) setManagers(team); }).catch(() => undefined);
    return () => { active = false; };
  }, [isAdmin, open]);

  function togglePlatform(platform: AdminPlatform) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateClientProfile({ name, email, accountType, creditDays });
    if (invalid) { setError(invalid); return; }
    setPending(true); setError("");
    const input = { name, email, accountType, platforms, creditDays: accountType === "PREPAGO" ? 0 : creditDays };
    try {
      if (client) {
        const saved = await updateAdminClient(client.id, { ...input, expectedPlatformsVersion: client.platformsVersion });
        /* La reasignación es su propio endpoint, solo de admin: el PATCH del
           cliente no toca la cartera. Solo se llama si de verdad cambió. */
        const reassigned = isAdmin && managerId !== (client.manager?.id ?? "")
          ? { ...saved, manager: (await assignClientManager(client.id, managerId || null)).manager }
          : saved;
        onSaved(reassigned);
      } else {
        const created = await createAdminClient({ ...input, managerId: isAdmin ? managerId || null : undefined });
        onSaved(created);
        onCreated?.(created);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar el cliente");
    } finally { setPending(false); }
  }

  return (
    <ModalShell open={open} labelledBy="client-form-title" className={styles.modal} onClose={onClose}>
      <h2 id="client-form-title">{client ? "editar cliente" : "crear nuevo cliente"}</h2>
      {/* noValidate: el globo nativo del navegador habla con su propia voz y no
          admite estilo. El mensaje lo escribe el producto, junto al formulario. */}
      <form onSubmit={submit} noValidate>
        <label><span>nombre</span><input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={80} /></label>
        <label><span>correo</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} /></label>
        <label><span>tipo de cuenta</span>
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as SaveAdminClient["accountType"])}>
            <option value="PREPAGO">prepago</option><option value="POSTPAGO">postpago</option>
          </select>
        </label>
        {isAdmin && <label><span>gestor</span>
          <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
            <option value="">sin asignar</option>
            {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.username}</option>)}
          </select>
        </label>}
        {accountType === "POSTPAGO" && <label><span>días de crédito</span><input type="number" min="1" max="365" value={creditDays} onChange={(event) => { setCreditDays(Number(event.target.value)); setError(""); }} /></label>}
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
