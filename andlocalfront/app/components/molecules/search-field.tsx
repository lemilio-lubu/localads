import { Search } from "lucide-react";
import styles from "./search-field.module.css";

/* El buscador de los listados. `placeholderTone` conserva las dos variantes que
   ya existían: apagado (facturas, verificaciones, activaciones) o en color de
   texto (clientes, equipo, transacciones). Ancho y posición, con `className`. */
export default function SearchField({ value, onChange, placeholder, placeholderTone = "muted", className = "" }: { value: string; onChange: (value: string) => void; placeholder: string; placeholderTone?: "muted" | "strong"; className?: string }) {
  return <label className={`${styles.search} ${className}`} data-placeholder={placeholderTone}><Search size={18} aria-hidden="true" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
