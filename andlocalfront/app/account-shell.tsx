"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import AccountTemplate from "./components/templates/account-template";
import NotificationBell from "./features/notifications/notification-bell";
import type { AccountPage, AccountType } from "./design-system/types";
import { getCurrentUser, logout, refreshSession } from "./lib/auth-api";
import { releasePushDevice } from "./lib/push-device";

export default function AccountShell({ accountType, activePage, contentSize = "standard", contentAlign = "start", children }: { accountType: AccountType; activePage: AccountPage; contentSize?: "standard" | "wide"; contentAlign?: "start" | "center"; children: ReactNode }) {
  const router = useRouter(); const [authorized, setAuthorized] = useState(false);
  useEffect(() => { let active = true; refreshSession().then((user) => { const expected = accountType === "prepago" ? "PREPAGO" : "POSTPAGO"; if (!user || user.role !== "CLIENT" || user.accountType !== expected) router.replace("/"); else if (user.mustChangePassword) router.replace("/cambiar-contrasena"); else if (active) setAuthorized(true); }); return () => { active = false; }; }, [accountType, router]);
  async function logOut() { await releasePushDevice(); await logout(); router.replace("/"); }
  if (!authorized) return null;
  return <AccountTemplate accountType={accountType} activePage={activePage} contentSize={contentSize} contentAlign={contentAlign} userName={getCurrentUser()?.displayName ?? getCurrentUser()?.username} onLogout={logOut} headerActions={<NotificationBell />}>{children}</AccountTemplate>;
}
