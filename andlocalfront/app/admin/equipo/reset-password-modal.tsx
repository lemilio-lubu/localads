"use client";

import ModalShell from "../../components/organisms/modal-shell";
import Button from "../../components/atoms/button";
import type { TeamMember } from "../../lib/team-api";
/* Misma composición que el modal de baja: título, una frase y las acciones. */
import styles from "./portfolio-handover-modal.module.css";
import own from "./reset-password-modal.module.css";

type Props = {
  member: TeamMember | null;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Confirmación de «restablecer» desde la fila de Equipo.
 *
 * Antes la fila lo hacía de un clic: la clave de la persona dejaba de servir y
 * sus sesiones se cerraban sin que nadie lo hubiera pedido dos veces. Al
 * confirmar se cierra este modal y sale el de credenciales de siempre.
 */
export default function ResetPasswordModal({ member, pending, error, onClose, onConfirm }: Props) {
  if (!member) return null;
  return (
    <ModalShell open labelledBy="reset-password-title" className={own.modal} onClose={onClose}>
      <h2 id="reset-password-title">restablecer contraseña</h2>
      <p className={styles.lead}>
        La contraseña actual de <strong>{member.username}</strong> dejará de servir y se cerrarán sus sesiones.
        Se generará una temporal para entregársela.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button variant="neutral" onClick={onClose} disabled={pending}>cancelar</Button>
        <Button variant="elevated" size="cta" onClick={onConfirm} disabled={pending}>{pending ? "restableciendo…" : "sí, restablecer"}</Button>
      </div>
    </ModalShell>
  );
}
