"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import AccountNavigation from "./components/account-navigation";
import BrandLogo from "./components/brand-logo";
import ProfileMenu from "./components/profile-menu";
import type { AccountPage, AccountType } from "./design-system/types";
import { getCurrentUser, logout, refreshSession } from "./lib/auth-api";
import styles from "./account-shell.module.css";

export default function AccountShell({ accountType, activePage, contentSize = "standard", children }: { accountType: AccountType; activePage: AccountPage; contentSize?: "standard" | "wide"; children: ReactNode }) {
  const router = useRouter(); const isPrepaid = accountType === "prepago"; const [authorized, setAuthorized] = useState(false);
  useEffect(() => { let active = true; refreshSession().then((user) => { const expected = accountType === "prepago" ? "PREPAGO" : "POSTPAGO"; if (!user || user.role !== "CLIENT" || user.accountType !== expected) router.replace("/"); else if (active) setAuthorized(true); }); return () => { active = false; }; }, [accountType, router]);
  async function logOut() { await logout(); router.replace("/"); }
  if (!authorized) return null;
  return <main className={styles.pageShell}><header className={styles.header}><BrandLogo edition={isPrepaid ? "pro" : "flex"} /><ProfileMenu userName={getCurrentUser()?.username} onLogout={logOut} /></header><div className={`${styles.workspace} ${contentSize === "wide" ? styles.wideWorkspace : ""}`}><AccountNavigation accountType={accountType} activePage={activePage} /><div className={styles.content}>{children}</div></div></main>;
}
