"use client";

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import { PointerEvent, useState } from "react";
import styles from "./login-wallet-deck.module.css";

/* Las tres tarjetas de la billetera del portal, como ilustración del login:
   quien entra ve de un vistazo qué hay dentro -sus plataformas de pauta, cada
   una con su saldo-. Es decorativa (aria-hidden): el texto que la acompaña es
   el que comunica. */

export type DeckState = "idle" | "gathering" | "launching";

const cards = [
  { id: "tiktok", label: "TikTok", logo: "/figma/tiktok.svg", w: 22, h: 26, amount: "US$ 1.250,00", className: styles.tiktok },
  { id: "google", label: "Google", logo: "/figma/google.svg", w: 22, h: 24, amount: "US$ 860,40", className: styles.google },
  { id: "meta", label: "Meta", logo: "/figma/meta.svg", w: 28, h: 19, amount: "US$ 2.340,15", className: styles.meta },
] as const;

/* Abanico: la del centro al frente; las de los lados giran y se abren. */
const fan = [
  { x: -112, y: 22, rotate: -12, z: -40 },
  { x: 112, y: 22, rotate: 12, z: -40 },
  { x: 0, y: 0, rotate: 0, z: 30 },
];

/* Muelles con poco rebote: se asientan, no botan. */
const settle = { type: "spring", stiffness: 110, damping: 20, mass: 1 } as const;
const follow = { stiffness: 90, damping: 18, mass: 0.8 } as const;

export default function LoginWalletDeck({ state }: { state: DeckState }) {
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  /* Cursor normalizado de -1 a 1 sobre el escenario. Mueve la inclinación de
     la baraja y la luz especular de las tarjetas, siempre con muelle. */
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, follow);
  const smoothY = useSpring(pointerY, follow);
  const rotateY = useTransform(smoothX, [-1, 1], [-10, 10]);
  const rotateX = useTransform(smoothY, [-1, 1], [8, -8]);
  const lightX = useTransform(smoothX, [-1, 1], [15, 85]);
  const lightY = useTransform(smoothY, [-1, 1], [10, 70]);
  const specular = useMotionTemplate`radial-gradient(circle at ${lightX}% ${lightY}%, rgb(255 255 255 / 32%), transparent 55%)`;

  function track(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
    pointerY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function reset() { pointerX.set(0); pointerY.set(0); setHovered(null); }

  return (
    <div className={styles.stage} onPointerMove={track} onPointerLeave={reset} aria-hidden="true">
      <span className={styles.floor} />
      <div className={styles.scaler}>
        <motion.div
          className={styles.deck}
          style={reduceMotion ? undefined : { rotateX, rotateY }}
          animate={state === "launching" && !reduceMotion ? { y: -80, z: 120, scale: 1.05, opacity: 0, filter: "blur(8px)" } : { y: 0, z: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.5, ease: [0.32, 0, 0.67, 0] }}
        >
          {cards.map((card, index) => {
            const pose = fan[index];
            const gathered = state !== "idle";
            const lift = hovered === index && !gathered ? -14 : 0;
            return (
              <motion.div
                key={card.id}
                className={`${styles.card} ${card.className} ${pose.x > 0 ? styles.mirrored : ""}`}
                style={{ zIndex: hovered === index ? 5 : index + 1 }}
                /* Entran desde la profundidad y se enfocan, una tras otra. */
                initial={reduceMotion ? false : { x: 0, y: 30, z: -260, rotate: 0, opacity: 0, filter: "blur(14px)" }}
                animate={{
                  x: gathered ? (index - 1) * 5 : pose.x,
                  y: (gathered ? index * -5 : pose.y) + lift,
                  z: gathered ? index * 4 : pose.z + (lift ? 20 : 0),
                  rotate: gathered ? (index - 1) * 1.5 : pose.rotate,
                  opacity: 1,
                  filter: "blur(0px)",
                }}
                transition={reduceMotion ? { duration: 0 } : { ...settle, delay: state === "idle" && hovered === null ? 0.2 + index * 0.14 : 0 }}
                onPointerEnter={() => setHovered(index)}
              >
                {/* La flotación va en una capa aparte para no pelear con el
                    abanico: cada tarjeta respira con su propio desfase. */}
                <motion.div
                  className={styles.face}
                  animate={reduceMotion || gathered ? { y: 0 } : { y: [0, -6, 0] }}
                  transition={reduceMotion || gathered ? { duration: 0.3 } : { duration: 5 + index * 0.8, repeat: Infinity, ease: "easeInOut", delay: 1 + index * 0.7 }}
                >
                  <motion.span className={styles.specular} style={reduceMotion ? undefined : { background: specular }} />
                  <div className={styles.top}>
                    <span className={styles.logo}><Image src={card.logo} alt="" width={card.w} height={card.h} /></span>
                    <span className={styles.brand}>{card.label}</span>
                  </div>
                  <span className={styles.chip} />
                  <div className={styles.bottom}>
                    <span className={styles.balance}><small>saldo disponible</small><strong>{card.amount}</strong></span>
                    <span className={styles.number}>•••• AND</span>
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
