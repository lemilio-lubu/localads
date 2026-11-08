import { CircleAlert } from "lucide-react";
import styles from "./form-error.module.css";

/* El error general de un formulario, debajo de sus campos. Sin mensaje no ocupa sitio. */
export default function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p className={styles.formError} role="alert"><CircleAlert size={16} aria-hidden="true" />{message}</p>;
}
