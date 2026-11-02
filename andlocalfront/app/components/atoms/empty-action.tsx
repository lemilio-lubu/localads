import Link from "next/link";
import { ReactNode } from "react";
import styles from "./empty-action.module.css";

/* Acción principal de un estado vacío («limpiar filtros», «hacer una
   recarga»): botón con onClick o enlace con href, con el mismo aspecto. */
type EmptyActionProps = { children: ReactNode } & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

export default function EmptyAction({ children, href, onClick }: EmptyActionProps) {
  if (href !== undefined) return <Link className={styles.action} href={href}>{children}</Link>;
  return <button type="button" className={styles.action} onClick={onClick}>{children}</button>;
}
