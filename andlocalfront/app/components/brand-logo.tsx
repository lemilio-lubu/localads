import Image from "next/image";
import styles from "./brand-logo.module.css";

type BrandLogoProps = {
  edition?: "pro" | "flex" | "admin";
  size?: "regular" | "compact";
};

export default function BrandLogo({ edition, size = "regular" }: BrandLogoProps) {
  return (
    <div className={`${styles.logo} ${size === "compact" ? styles.compact : ""}`} aria-label={`AND Local Ads${edition ? ` ${edition}` : ""}`}>
      <span className={styles.brandMark}>
        <Image src="/figma/logo-and.svg" alt="AND" width={71} height={39} priority />
        <Image src="/figma/logo-localads.svg" alt="Local Ads" width={77} height={37} priority />
      </span>
      {edition && (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <strong>{edition}</strong>
        </>
      )}
    </div>
  );
}
