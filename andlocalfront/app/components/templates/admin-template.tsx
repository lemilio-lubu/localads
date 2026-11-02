import Link from "next/link";
import { ReactNode } from "react";
import BrandLogo from "../atoms/brand-logo";
import ProfileMenu from "../molecules/profile-menu";
import PwaInstallButton from "../molecules/pwa-install-button";
import styles from "./admin-template.module.css";

/* El esqueleto del portal admin, sin sesión: quién entra y con qué rol lo decide AdminShell. */
export default function AdminTemplate({ pathname, role, userName, onLogout, children }: { pathname: string; role: "ADMIN" | "GESTOR"; userName: string; onLogout: () => void; children: ReactNode }) {
  const title = pathname.includes("transacciones") ? "Transacciones" : pathname.includes("verificaciones") ? "Verificaciones" : pathname.includes("activaciones") ? "Activaciones de pauta" : pathname.includes("equipo") ? "Equipo" : pathname.includes("ajustes") ? "Ajustes" : "Clientes";
  return <main className={styles.shell}><aside className={styles.sidebar}><div className={styles.brand}><BrandLogo edition={role === "ADMIN" ? "admin" : "gestor"} size="compact" /></div><nav aria-label="Administración"><Link className={pathname.includes("/admin/clientes") ? styles.active : ""} href="/admin/clientes">clientes</Link><Link className={pathname.includes("/admin/transacciones") ? styles.active : ""} href="/admin/transacciones">transacciones</Link><Link className={pathname.includes("/admin/verificaciones") ? styles.active : ""} href="/admin/verificaciones">verificaciones</Link><Link className={pathname.includes("/admin/activaciones") ? styles.active : ""} href="/admin/activaciones">activaciones</Link>{role === "ADMIN" && <Link className={pathname.includes("/admin/equipo") ? styles.active : ""} href="/admin/equipo">equipo</Link>}<Link className={pathname.includes("/admin/ajustes") ? styles.active : ""} href="/admin/ajustes">ajustes</Link></nav><div className={styles.sidebarFooter}><ProfileMenu userName={userName} role={role === "ADMIN" ? "admin" : "gestor"} compact placement="up" onLogout={onLogout} /></div></aside><section className={styles.workspace}><header><h1>{title}</h1><PwaInstallButton /></header>{children}</section></main>;
}
