import { CircleAlert } from "lucide-react";
import { splitErrorReference } from "../../lib/api-error";
import ErrorReference from "./error-reference";
import styles from "./form-error.module.css";

/* El error general de un formulario, debajo de sus campos. Sin mensaje no ocupa sitio.
   Si es un fallo del servidor, debajo va su código de referencia para soporte. */
export default function FormError({ message }: { message: string }) {
  if (!message) return null;
  const { text, reference } = splitErrorReference(message);
  if (!reference) return <p className={styles.formError} role="alert"><CircleAlert size={16} aria-hidden="true" />{text}</p>;
  return <div className={styles.group} role="alert">
    <p className={styles.formError}><CircleAlert size={16} aria-hidden="true" />{text}</p>
    <ErrorReference reference={reference} className={styles.reference} />
  </div>;
}
