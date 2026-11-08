import styles from "./list-row.module.css";

/* Texto libre que puede recortarse (correo, razón social, banco): siempre con
   el valor completo en `title`. Un importe, un estado o una fecha no pasan por
   aquí: esos nunca se recortan (UX-05). */
export default function TruncatedText({ children, className = "" }: { children: string; className?: string }) {
  return <span className={`${styles.truncate} ${className}`} title={children}>{children}</span>;
}
