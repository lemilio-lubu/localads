"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ReactNode, useEffect, useRef } from "react";
import { backdropEnterTransition, backdropExitTransition, modalEnterTransition, modalExitTransition } from "../design-system/motion";
import styles from "./modal-shell.module.css";

type ModalShellProps = {
  open: boolean;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
};

export default function ModalShell({ open, labelledBy, children, className = "", onClose }: ModalShellProps) {
  const reduceMotion = useReducedMotion();
  const modal = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = modal.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocus.current?.focus();
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: reduceMotion ? { duration: 0 } : backdropExitTransition }}
          transition={reduceMotion ? { duration: 0 } : backdropEnterTransition}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            ref={modal}
            className={`${styles.panel} ${className}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={reduceMotion ? false : { opacity: 0, transform: "scale(0.96)" }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transform: "scale(0.96)", transition: modalExitTransition }}
            transition={reduceMotion ? { duration: 0 } : modalEnterTransition}
          >
            {children}
            <button ref={closeButton} type="button" className={styles.closeButton} onClick={onClose} aria-label="Cerrar modal">
              <X size={24} strokeWidth={2} aria-hidden="true" />
            </button>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
