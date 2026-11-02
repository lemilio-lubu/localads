import styles from "./row-opener.module.css";

/* Botón invisible que cubre la fila entera y abre su detalle: toda la fila se
   pulsa, pero para el teclado y el lector es un solo botón con nombre. La fila
   pone position: relative y deja pasar los clics al botón con
   `> *:not([data-row-opener], …) { pointer-events: none }`; lo que deba seguir
   pulsable por encima (las acciones de la fila) queda fuera de esa regla. */
export default function RowOpener({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className={styles.opener} data-row-opener="" onClick={onClick} aria-label={label} aria-haspopup="dialog" />;
}
