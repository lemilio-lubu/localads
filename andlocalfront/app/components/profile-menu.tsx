"use client";

import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { popoverExitTransition, popoverTransition } from "../design-system/motion";
import styles from "./profile-menu.module.css";

type ProfileMenuProps = { onLogout: () => void; userName?: string; role?: string; compact?: boolean };

export default function ProfileMenu({ onLogout, userName = "user name", role, compact = false }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <div className={`${styles.profileArea} ${compact ? styles.compact : ""}`}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <span className={styles.identity}><strong>{userName}</strong>{role && <small>{role}</small>}</span>
        <span className={styles.avatar}>
          <Image src="/figma/avatar-bg.svg" alt="" width={72} height={72} />
          <Image className={styles.person} src="/figma/avatar-person.svg" alt="" width={39} height={39} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.menu}
            role="menu"
            initial={reduceMotion ? false : { opacity: 0, transform: "translateY(-4px)" }}
            animate={{ opacity: 1, transform: "translateY(0)" }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transform: "translateY(-4px)", transition: popoverExitTransition }}
            transition={popoverTransition}
          >
            <button type="button" role="menuitem" onClick={onLogout}>cerrar sesión</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
