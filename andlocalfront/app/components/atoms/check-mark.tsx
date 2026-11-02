import styles from "./check-mark.module.css";

/* Marca redonda con el check de Figma (public/figma/check.svg). Sin marcar se
   ve como en el diseño, aro y check en gris; marcada se rellena de marca con
   el check en blanco, para que el estado se lea de un vistazo. Es solo dibujo:
   el input real lo pone quien la usa (Checkbox, ChoiceCard). */
export default function CheckMark({ checked, className = "" }: { checked: boolean; className?: string }) {
  return (
    <svg className={`${styles.mark} ${className}`} data-checked={checked || undefined} viewBox="0 0 19 19" aria-hidden="true">
      <circle className={styles.fill} cx="9.5" cy="9.5" r="9.5" />
      <path className={styles.ring} fillRule="evenodd" clipRule="evenodd" d="M9.5 0C4.2533 0 0 4.2533 0 9.5C0 14.7467 4.2533 19 9.5 19C14.7467 19 19 14.7467 19 9.5C19 4.2533 14.7467 0 9.5 0ZM1.32558 9.5C1.32558 4.9854 4.9854 1.32558 9.5 1.32558C14.0146 1.32558 17.6744 4.9854 17.6744 9.5C17.6744 14.0146 14.0146 17.6744 9.5 17.6744C4.9854 17.6744 1.32558 14.0146 1.32558 9.5Z" />
      <path className={styles.check} d="M13.0617 7.75933C13.3205 7.50053 13.3205 7.08087 13.0617 6.82203C12.8028 6.5632 12.3832 6.5632 12.1244 6.82203L8.17442 10.7719L6.87564 9.47322C6.61681 9.21438 6.19714 9.21438 5.93831 9.47322C5.67948 9.73206 5.67948 10.1517 5.93831 10.4105L7.70575 12.1779C7.96462 12.4368 8.38421 12.4368 8.64305 12.1779L13.0617 7.75933Z" />
    </svg>
  );
}
