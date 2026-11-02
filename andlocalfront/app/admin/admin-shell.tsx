"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import AdminTemplate from "../components/templates/admin-template";
import { getCurrentUser, logout, refreshSession } from "../lib/auth-api";

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const [authorized, setAuthorized] = useState(false);
  /* Por defecto el rol estrecho: si algo fallara al resolver la sesión, la
     navegación se queda corta en vez de ofrecer de más. La pantalla no se
     monta hasta que `authorized` es cierto, así que nunca se ve este valor. */
  const [role, setRole] = useState<"ADMIN" | "GESTOR">("GESTOR");
  /* Admin y gestor comparten el portal; el recorte de datos lo aplica el
     backend. Aquí solo se decide qué entradas de navegación tienen sentido. */
  useEffect(() => { let active = true; refreshSession().then((user) => { if (!user || (user.role !== "ADMIN" && user.role !== "GESTOR")) router.replace("/"); else if (user.mustChangePassword) router.replace("/cambiar-contrasena"); else if (active) { setRole(user.role); setAuthorized(true); } }); return () => { active = false; }; }, [router]);
  async function logOut() { await logout(); router.replace("/"); }
  if (!authorized) return null;
  return <AdminTemplate pathname={pathname} role={role} userName={getCurrentUser()?.displayName ?? getCurrentUser()?.username ?? "admin"} onLogout={logOut}>{children}</AdminTemplate>;
}
