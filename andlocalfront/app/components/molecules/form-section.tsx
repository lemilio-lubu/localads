import { ReactNode, useId } from "react";
import layout from "./form-layout.module.css";

/* Un panel gris con su título. El panel (.section) vive en form-layout porque
   ajustes lo usa también sin título. */
export default function FormSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`${layout.section} ${className}`} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}
