import { formatClock, formatDay } from "../lib/format";
import styles from "./list-row.module.css";

/**
 * Dia y hora en dos lineas, como fija la fila canonica en `patrones-lista.md`.
 *
 * Las tres listas lo resolvian con un `formatDateTime` de una sola linea. En
 * «tus facturas» la columna mide 100px y la hora se perdia por elipsis
 * —«18/09/2026, 12…»—, asi que el dato no es que se leyera distinto segun la
 * pantalla: es que en una no se leia. En dos lineas cabe, y de paso ocupa el
 * alto que la fila ya reservaba y estaba vacio.
 */
export default function DateCell({ value, label = "fecha" }: { value: string; label?: string }) {
  return (
    <div className={styles.cell}>
      <strong>{label}</strong>
      <span>{formatDay(value)}</span>
      <span className={styles.subtle}>{formatClock(new Date(value))}</span>
    </div>
  );
}
