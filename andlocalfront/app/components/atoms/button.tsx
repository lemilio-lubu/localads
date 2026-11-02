import type { ComponentProps } from "react";
import styles from "./button.module.css";

/* Botón de acción en pastilla. La variante dice qué hace:
   - primary: la acción principal (verde de marca).
   - secondary: blanco con borde, para una acción que no es la principal.
   - ghost: solo texto, para cancelar o volver.
   - neutral: gris, para acciones de fila que no deciden nada.
   - danger / danger-soft: acciones destructivas, rellena o suave.
   - amber: poner en revisión.
   size compact (32px) va dentro de filas; regular (40px) en el resto.
   Relleno y letra los puede ajustar la pantalla con className: la base no
   tiene especificidad y cualquier clase de la pantalla gana. */
type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "neutral" | "danger" | "danger-soft" | "amber";
  size?: "regular" | "compact";
};

export default function Button({ variant = "primary", size = "regular", type = "button", className = "", ...props }: ButtonProps) {
  return <button {...props} type={type} className={`${styles.button} ${className}`} data-variant={variant} data-size={size} />;
}
