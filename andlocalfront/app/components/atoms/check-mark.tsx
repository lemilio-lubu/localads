import { Check } from "lucide-react";
import styles from "./check-mark.module.css";

/* Marca redonda que se rellena de marca al marcarse. Es solo dibujo: el input
   real lo pone quien la usa (Checkbox, ChoiceCard), que le pasa su estado. */
export default function CheckMark({ checked, className = "" }: { checked: boolean; className?: string }) {
  return <span className={`${styles.mark} ${className}`} data-checked={checked || undefined} aria-hidden="true"><Check size={14} strokeWidth={3} /></span>;
}
