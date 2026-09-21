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
  /* Por defecto el rol estrecho: si algo fallara al resolver la sesión, la
     navegación se queda corta en vez de ofrecer de más. La pantalla no se
     monta hasta que `authorized` es cierto, así que nunca se ve este valor. */
  const [role, setRole] = useState<"ADMIN" | "GESTOR">("GESTOR");
  const title = pathname.includes("transacciones") ? "Transacciones" : pathname.includes("verificaciones") ? "Verificaciones" : pathname.includes("activaciones") ? "Activaciones de pauta" : pathname.includes("equipo") ? "Equipo" : "Clientes";
  /* Admin y gestor comparten el portal; el recorte de datos lo aplica el
     backend. Aquí solo se decide qué entradas de navegación tienen sentido. */
  useEffect(() => { let active = true; refreshSession().then((user) => { if (!user || (user.role !== "ADMIN" && user.role !== "GESTOR")) router.replace("/"); else if (user.mustChangePassword) router.replace("/cambiar-contrasena"); else if (active) { setRole(user.role); setAuthorized(true); } }); return () => { active = false; }; }, [router]);
  async function logOut() { await logout(); router.replace("/"); }
  if (!authorized) return null;
  return <main className={styles.shell}><aside className={styles.sidebar}><div className={styles.brand}><BrandLogo edition={role === "ADMIN" ? "admin" : "gestor"} size="compact" /></div><nav aria-label="Administración"><Link className={pathname.includes("/admin/clientes") ? styles.active : ""} href="/admin/clientes">clientes</Link><Link className={pathname.includes("/admin/transacciones") ? styles.active : ""} href="/admin/transacciones">transacciones</Link><Link className={pathname.includes("/admin/verificaciones") ? styles.active : ""} href="/admin/verificaciones">verificaciones</Link><Link className={pathname.includes("/admin/activaciones") ? styles.active : ""} href="/admin/activaciones">activaciones</Link>{role === "ADMIN" && <Link className={pathname.includes("/admin/equipo") ? styles.active : ""} href="/admin/equipo">equipo</Link>}</nav><div className={styles.sidebarFooter}><ProfileMenu userName={getCurrentUser()?.username ?? "admin"} role={role === "ADMIN" ? "admin" : "gestor"} compact placement="up" onLogout={logOut} /></div></aside><section className={styles.workspace}><header><h1>{title}</h1></header>{children}</section></main>;
}
