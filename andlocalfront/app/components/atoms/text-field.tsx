import type { ComponentProps } from "react";
import styles from "./text-field.module.css";

/* Campo de texto común: input, textarea y select comparten aspecto y estados.
   Cuatro ejes, cada uno con pocas opciones:
   - surface: blanco con borde (outlined), borde tenue (soft), gris sin borde
     (filled), blanco con relieve (elevated) o sin nada, dentro de otro control (bare).
   - shape: esquinas small, menu, control o pill.
   - size: alto regular (48), button (40), compact (32) o auto.
   - tone: color del foco, verde de marca, rojo (danger) o ámbar (amber).
   Ancho, relleno y tamaño de letra los ajusta la pantalla con className: la
   base no tiene especificidad y cualquier clase de la pantalla gana. */
type FieldLook = {
  surface?: "outlined" | "soft" | "filled" | "elevated" | "bare";
  shape?: "small" | "menu" | "control" | "pill";
  size?: "regular" | "button" | "compact" | "auto";
  tone?: "brand" | "danger" | "amber";
};

function look({ surface = "outlined", shape = "menu", size, tone = "brand" }: FieldLook, fallbackSize: NonNullable<FieldLook["size"]>) {
  return { "data-surface": surface, "data-shape": shape, "data-size": size ?? fallbackSize, "data-tone": tone };
}

export function TextInput({ surface, shape, size, tone, className = "", ...props }: FieldLook & Omit<ComponentProps<"input">, "size">) {
  return <input {...props} className={`${styles.field} ${className}`} {...look({ surface, shape, size, tone }, surface === "bare" ? "auto" : "regular")} />;
}

export function TextArea({ surface, shape, size, tone, className = "", ...props }: FieldLook & ComponentProps<"textarea">) {
  return <textarea {...props} className={`${styles.field} ${className}`} {...look({ surface, shape, size, tone }, "auto")} />;
}

export function Select({ surface, shape, size, tone, className = "", ...props }: FieldLook & Omit<ComponentProps<"select">, "size">) {
  return <select {...props} className={`${styles.field} ${className}`} {...look({ surface, shape, size, tone }, "regular")} />;
}
