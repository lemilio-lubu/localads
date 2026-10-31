import { ChevronRight } from "lucide-react";
import { ReactNode } from "react";
import styles from "./disclosure.module.css";

type Props = {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  summaryClassName?: string;
};

/* Un desplegable con un chevron que gira al abrir. Sigue siendo un <details>
   nativo (teclado, lectores de pantalla y «buscar en la página» funcionan sin
   código), pero sin el triángulo del navegador, que cambia de forma y de tamaño
   según el sistema y no se puede estilizar. */
export default function Disclosure({ summary, children, defaultOpen = false, className = "", summaryClassName = "" }: Props) {
  return (
    <details className={`${styles.disclosure} ${className}`} open={defaultOpen}>
      <summary className={`${styles.summary} ${summaryClassName}`}>
        <ChevronRight className={styles.chevron} size={16} strokeWidth={2.25} aria-hidden="true" />
        <span>{summary}</span>
      </summary>
      {children}
    </details>
  );
}
