import { MouseEventHandler, ReactNode } from "react";
import styles from "./toolbar-button.module.css";

/* El botón suave de la barra de un listado («crear cuenta», «crear nuevo
   cliente»): gris en reposo, se levanta con la sombra de tarjeta al pasar. */
export default function ToolbarButton({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  return <button type="button" className={`${styles.button} ${className}`} onClick={onClick}>{children}</button>;
}
