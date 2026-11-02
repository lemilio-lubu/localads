import type { ComponentProps } from "react";
import styles from "./text-button.module.css";

/* Acción con aspecto de enlace: «limpiar filtros», «reintentar» dentro de un
   mensaje, «tomar el caso», «vincular cliente»…
   - size: caption o body-sm, o inherit para tomar la letra del texto que lo rodea.
   - tone: verde de marca, o inherit para tomar el color del texto (un error).
   - underline: siempre subrayado, o solo con el puntero encima.
   Con un icono dentro se alinea con el texto. */
type TextButtonProps = ComponentProps<"button"> & {
  size?: "caption" | "body-sm" | "inherit";
  tone?: "brand" | "inherit";
  underline?: "always" | "hover";
};

export default function TextButton({ size = "caption", tone = "brand", underline = "always", type = "button", className = "", ...props }: TextButtonProps) {
  return <button {...props} type={type} className={`${styles.button} ${className}`} data-size={size} data-tone={tone} data-underline={underline} />;
}
