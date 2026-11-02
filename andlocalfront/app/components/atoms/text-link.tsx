import Link from "next/link";
import type { ComponentProps } from "react";
import styles from "./text-button.module.css";

/* El aspecto de TextButton en un enlace: mismo subrayado, foco y tamaños. */
type TextLinkProps = ComponentProps<typeof Link> & { size?: "caption" | "body-sm" | "inherit"; tone?: "brand" | "muted" | "inherit"; weight?: "bold" | "regular"; underline?: "always" | "hover"; };

export default function TextLink({ size = "caption", tone = "brand", weight = "bold", underline = "always", className = "", ...props }: TextLinkProps) {
  return <Link {...props} className={`${styles.button} ${className}`} data-size={size} data-tone={tone} data-weight={weight} data-underline={underline} />;
}
