import styles from "./list-row.module.css";

/* Texto libre que puede recortarse (correo, razón social, banco). El valor
   completo sale en el tooltip de OverflowTooltip al pasar el ratón; no lleva
   `title`, que no se veía bajo el botón de la fila. Un importe, un estado o una
   fecha no pasan por aquí: esos nunca se recortan (UX-05). */
export default function TruncatedText({ children, className = "" }: { children: string; className?: string }) {
  return <span className={`${styles.truncate} ${className}`}>{children}</span>;
}
