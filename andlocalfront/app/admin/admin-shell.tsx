"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import BrandLogo from "../components/brand-logo";
import ProfileMenu from "../components/profile-menu";
import { getCurrentUser, logout, refreshSession } from "../lib/auth-api";
import styles from "./admin-shell.module.css";

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const [authorized, setAuthorized] = useState(false);
  const title = pathname.includes("transacciones") ? "Transacciones" : pathname.includes("verificaciones") ? "Verificaciones" : pathname.includes("activaciones") ? "Activaciones de pauta" : "Clientes";
  useEffect(() => { let active = true; refreshSession().then((user) => { if (!user || user.role !== "ADMIN") router.replace("/"); else if (active) setAuthorized(true); }); return () => { active = false; }; }, [router]);
  async function logOut() { await logout(); router.replace("/"); }
  if (!authorized) return null;
  return <main className={styles.shell}><aside className={styles.sidebar}><div className={styles.brand}><BrandLogo edition="admin" size="compact" /></div><nav aria-label="Administración"><Link className={pathname.includes("/admin/clientes") ? styles.active : ""} href="/admin/clientes">clientes</Link><Link className={pathname.includes("/admin/transacciones") ? styles.active : ""} href="/admin/transacciones">transacciones</Link><Link className={pathname.includes("/admin/verificaciones") ? styles.active : ""} href="/admin/verificaciones">verificaciones</Link><Link className={pathname.includes("/admin/activaciones") ? styles.active : ""} href="/admin/activaciones">activaciones</Link></nav><div className={styles.sidebarFooter}><ProfileMenu userName={getCurrentUser()?.username ?? "admin"} role="admin" compact placement="up" onLogout={logOut} /></div></aside><section className={styles.workspace}><header><h1>{title}</h1></header>{children}</section></main>;
}
