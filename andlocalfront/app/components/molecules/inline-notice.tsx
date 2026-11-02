import { ReactNode } from "react";
import TextButton from "../atoms/text-button";
import styles from "./inline-notice.module.css";

/* Aviso en una caja gris dentro de la pantalla: un fallo con «reintentar» o
   un estado sin datos. Más discreto que LoadError, que ocupa el sitio de una
   lista entera. */
export default function InlineNotice({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <p className={styles.notice} role={onRetry ? "alert" : "status"}>{children}{onRetry && <> <TextButton size="inherit" onClick={onRetry}>reintentar</TextButton></>}</p>;
}
