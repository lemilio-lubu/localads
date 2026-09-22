import Image from "next/image";
import type { AdvertisingPlatform } from "../design-system/types";
import styles from "./platform-pill.module.css";

type PlatformPillProps = {
  platform: AdvertisingPlatform;
  size?: "compact" | "regular" | "filter";
  /** Solo para `size="filter"`: una pastilla que filtra esta encendida o
      apagada. En las filas la pastilla es una etiqueta, no un control, y
      siempre va a color — por eso el valor por defecto es `true`. */
  active?: boolean;
};

/* Los logotipos de marca ya viven en public/figma. Van con el nombre, nunca
   solos: identificar una plataforma únicamente por su logo obliga a recordar,
   y las heurísticas del proyecto lo marcan como defecto. Cada uno conserva su
   proporción original —Meta es apaisado, TikTok vertical—, así que las medidas
   no son cuadradas. */
const logos: Record<AdvertisingPlatform, { src: string; width: number; height: number }> = {
  meta: { src: "/figma/meta.svg", width: 16, height: 11 },
  google: { src: "/figma/google.svg", width: 12, height: 13 },
  tiktok: { src: "/figma/tiktok.svg", width: 11, height: 12 },
};

export default function PlatformPill({ platform, size = "regular", active = true }: PlatformPillProps) {
  const logo = logos[platform];
  const idle = size === "filter" && !active;
  return (
    <span className={`${styles.pill} ${styles[platform]} ${styles[size]} ${idle ? styles.idle : ""}`}>
      {size !== "regular" && <span className={styles.logo}><Image src={logo.src} alt="" width={logo.width} height={logo.height} /></span>}
      {platform === "tiktok" ? "tik tok" : platform}
    </span>
  );
}
