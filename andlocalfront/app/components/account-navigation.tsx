"use client";

import Link from "next/link";
import type { AccountPage, AccountType } from "../design-system/types";
import styles from "./account-navigation.module.css";

type AccountNavigationProps = {
  accountType: AccountType;
  activePage: AccountPage;
};

export default function AccountNavigation({ accountType, activePage }: AccountNavigationProps) {
  return (
    <nav className={styles.navigation} aria-label={`Cuenta ${accountType === "prepago" ? "prepago" : "postpago"}`}>
      <Link className={activePage === "assets" ? styles.active : ""} aria-current={activePage === "assets" ? "page" : undefined} href={`/${accountType}/activos`}>tus activos</Link>
      <Link className={activePage === "recharge" ? styles.active : ""} aria-current={activePage === "recharge" ? "page" : undefined} href={`/${accountType}`}>recargar</Link>
      <Link className={activePage === "invoices" ? styles.active : ""} aria-current={activePage === "invoices" ? "page" : undefined} href={`/${accountType}/facturas`}>tus facturas</Link>
    </nav>
  );
}
