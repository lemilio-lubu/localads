import { ChevronDown, CircleAlert, type LucideIcon } from "lucide-react";
import { ReactNode, useId } from "react";
import styles from "./form-field.module.css";

/* .mono (RUC), .valid (ayuda en verde) y .fieldError (un error suelto con el
   aspecto del de un campo) los aplica quien llama. */
export { styles as fieldStyles };

/* Etiqueta arriba, icono dentro del control y un mensaje debajo que es ayuda
   en reposo y error cuando falla, en el mismo sitio. El control lo pone quien
   llama, con el id y el aria-describedby que se le pasan. */
export default function FormField({ label, hint, error, Icon, children, className = "" }: { label: string; hint?: ReactNode; error?: string; Icon: LucideIcon; children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode; className?: string }) {
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

/* La flecha de un selector: el mismo chevron que los desplegables, en lugar del triángulo dibujado con CSS. Va justo después del <select>, dentro de su campo. */
export function SelectChevron() {
  return <ChevronDown className={styles.selectChevron} size={16} strokeWidth={2.25} aria-hidden="true" />;
}
