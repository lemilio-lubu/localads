import { RotateCw } from "lucide-react";
import Button from "../atoms/button";
import { splitErrorReference } from "../../lib/api-error";
import ErrorReference from "./error-reference";
import styles from "./load-error.module.css";

/* «No se pudo cargar X» con el motivo y «reintentar». Es un error, no un estado
   vacío: va en rojo y siempre ofrece salida. `frame` conserva los tres marcos
   que ya usaban los listados: tarjeta, control o sin marco (facturas).
   `text` conserva cómo se veía el texto donde no salía en rojo: en clientes el
   título quedaba gris y en facturas todo el texto, porque una regla de estado
   vacío pisaba el color de error. Pendiente de decidir si pasan a rojo.
   La base no fija márgenes: el aire alrededor lo pone la pantalla con className. */
export default function LoadError({ title, message, frame = "card", text = "danger", className = "", onRetry }: { title: string; message: string; frame?: "card" | "control" | "bare"; text?: "danger" | "neutral-title" | "neutral"; className?: string; onRetry: () => void }) {
  const { text: detail, reference } = splitErrorReference(message);
  return <div className={`${styles.error} ${className}`} data-frame={frame} data-text={text} role="alert">
    <p><strong>{title}</strong></p>
    <p>{detail}</p>
    <ErrorReference reference={reference} className={styles.reference} />
    <Button variant="danger" className={styles.retry} onClick={onRetry}><RotateCw size={16} aria-hidden="true" />reintentar</Button>
  </div>;
}
