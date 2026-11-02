import { ReactNode } from "react";
import BrandLogo from "../atoms/brand-logo";
import AccountNavigation from "../molecules/account-navigation";
import ProfileMenu from "../molecules/profile-menu";
import PwaInstallButton from "../molecules/pwa-install-button";
import type { AccountPage, AccountType } from "../../design-system/types";
import styles from "./account-template.module.css";

/* El esqueleto del portal de cliente, sin sesión: quién entra lo decide AccountShell. */
export default function AccountTemplate({ accountType, activePage, contentSize = "standard", contentAlign = "start", userName, onLogout, children }: { accountType: AccountType; activePage: AccountPage; contentSize?: "standard" | "wide"; contentAlign?: "start" | "center"; userName?: string; onLogout: () => void; children: ReactNode }) {
  const isPrepaid = accountType === "prepago";
  return <main className={styles.pageShell} data-content-align={contentAlign}><header className={styles.header}><BrandLogo edition={isPrepaid ? "pre" : "pos"} /><PwaInstallButton /></header><div className={`${styles.workspace} ${contentSize === "wide" ? styles.wideWorkspace : ""}`}><div className={styles.navColumn}><AccountNavigation accountType={accountType} activePage={activePage} /><div className={styles.navFooter}><ProfileMenu userName={userName} compact placement="up" links={[{ label: "cómo pagar", href: `/${accountType}/pagar` }, { label: "cambiar contraseña", href: "/cambiar-contrasena" }]} onLogout={onLogout} /></div></div><div className={styles.content}>{children}</div></div></main>;
}
