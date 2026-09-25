"use client";

import { Check, CircleAlert, type LucideIcon } from "lucide-react";
import { ReactNode, useId } from "react";
import styles from "./form-modal.module.css";

/* Piezas comunes de los formularios en modal del portal (cliente, equipo).
   Viven aquí para que los modales no vuelvan a parecerse cada uno a su
   manera: la cabecera, las secciones, los campos con icono y las tarjetas de
   elección se ven y se comportan igual en todos. */
export { styles as formStyles };

/* Cabecera con el lenguaje del detalle de cliente: etiqueta en pastilla gris
   («cliente», «equipo») y título grande debajo. */
export function FormHeader({ Icon, eyebrow, title, subtitle, titleId }: { Icon: LucideIcon; eyebrow: string; title: string; subtitle?: string; titleId: string }) {
  return (
    <header className={styles.header}>
      <span className={styles.eyebrow}><Icon size={14} strokeWidth={2} aria-hidden="true" />{eyebrow}</span>
      <h2 id={titleId}>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}

export function FormSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`${styles.section} ${className}`} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/* Etiqueta arriba, icono dentro del control y un mensaje debajo que es ayuda
   en reposo y error cuando falla, en el mismo sitio. El control lo pone quien
   llama, con el id y el aria-describedby que se le pasan. */
export function FormField({ label, hint, error, Icon, children, className = "" }: { label: string; hint?: ReactNode; error?: string; Icon: LucideIcon; children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode; className?: string }) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error || hint;
  return (
    <div className={`${styles.field} ${className}`} data-invalid={Boolean(error)}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.control}>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        {children({ id, describedBy: message ? messageId : undefined, invalid: Boolean(error) })}
      </div>
      {message && <p id={messageId} className={error ? styles.fieldError : styles.fieldHint}>{error && <CircleAlert size={14} aria-hidden="true" />}{message}</p>}
    </div>
  );
}

/* Marca redonda de las tarjetas de elección; se rellena cuando el input de la
   tarjeta está marcado. */
export function ChoiceCheck() {
  return <span className={styles.choiceCheck} aria-hidden="true"><Check size={14} strokeWidth={3} /></span>;
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p className={styles.formError} role="alert"><CircleAlert size={16} aria-hidden="true" />{message}</p>;
}
