import type { AdvertisingPlatform } from "../design-system/types";
import styles from "./platform-pill.module.css";

type PlatformPillProps = {
  platform: AdvertisingPlatform;
  size?: "compact" | "regular";
};

export default function PlatformPill({ platform, size = "regular" }: PlatformPillProps) {
  return (
    <span className={`${styles.pill} ${styles[platform]} ${styles[size]}`}>
      {platform === "tiktok" ? "tik tok" : platform}
    </span>
  );
}
