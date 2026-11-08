import CopyCode from "./copy-code";
import styles from "./error-reference.module.css";

/* «código de referencia 4fbfb81d copiar» debajo de un error del servidor.
   Es lo que la persona le pasa a soporte; soporte lo busca en Seguridad o en
   los logs. Sin código no ocupa sitio. */
export default function ErrorReference({ reference, className = "" }: { reference: string | null; className?: string }) {
  if (!reference) return null;
  return <p className={`${styles.reference} ${className}`}>código de referencia <CopyCode code={reference} tone="strong" size="small" mono /></p>;
}
