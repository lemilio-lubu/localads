"use client";

import { MouseEventHandler, ReactNode } from "react";
import styles from "./action-button.module.css";

type ActionButtonProps = {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  stretch?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export default function ActionButton({ children, type = "button", disabled = false, stretch = false, className = "", onClick }: ActionButtonProps) {
  return (
    <button
      className={`${styles.button} ${stretch ? styles.stretch : ""} ${className}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
