import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./pagination.module.css";

/* «anterior · página N de M · siguiente». No se pinta con una sola página. */
export default function Pagination({ page, totalPages, disabled = false, label, onChange }: { page: number; totalPages: number; disabled?: boolean; label: string; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <nav className={styles.pagination} aria-label={label}>
    <button type="button" disabled={page <= 1 || disabled} onClick={() => onChange(Math.max(1, page - 1))}><ChevronLeft size={16} aria-hidden="true" />anterior</button>
    <span aria-live="polite">página {page} de {totalPages}</span>
    <button type="button" disabled={page >= totalPages || disabled} onClick={() => onChange(Math.min(totalPages, page + 1))}>siguiente<ChevronRight size={16} aria-hidden="true" /></button>
  </nav>;
}
