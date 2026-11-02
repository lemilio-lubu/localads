import { ReactNode } from "react";
import CheckMark from "../atoms/check-mark";
import styles from "./checkbox.module.css";

/* Casilla con texto. El input nativo sigue ahí, invisible pero enfocable; lo
   que se ve es la misma marca que en las tarjetas de elección. Color y sitio
   los pone la pantalla con className. */
export default function Checkbox({ checked, onChange, children, className = "" }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; className?: string }) {
  return (
    <label className={`${styles.checkbox} ${className}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <CheckMark checked={checked} className={styles.mark} />
      <span>{children}</span>
    </label>
  );
}
