import type { Page } from "@playwright/test";

export type Severity = "P0" | "P1" | "P2";

/* P0 roto (no se puede usar), P1 degradado (se usa, mal), P2 pulido. */
export type Finding = { severity: Severity; rule: string; detail: string; target?: string };

type Options = { touch: boolean; modal: boolean };

/* Las mediciones corren dentro de la página y devuelven a los infractores con
   una descripción legible: etiqueta, las dos primeras clases (los nombres de
   CSS Modules en dev incluyen el archivo y la clase) y el principio del texto. */
export function measure(page: Page, options: Options): Promise<Finding[]> {
  return page.evaluate(({ touch, modal }) => {
    const findings: { severity: "P0" | "P1" | "P2"; rule: string; detail: string; target?: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const dialog = modal ? document.querySelector<HTMLElement>('[role="dialog"]') : null;
    const scope: ParentNode = dialog ?? document;

    const describe = (element: Element) => {
      const classes = typeof element.className === "string"
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name.replace(/^.*__/, "")}`).join("")
        : "";
      const text = (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${element.tagName.toLowerCase()}${classes}${text ? ` «${text}»` : ""}`;
    };
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
    };
    /* Un ancestro que recorta en horizontal contiene el desbordamiento: el
       contenido puede quedar oculto, pero la página no se desplaza. */
    const clippedByAncestor = (element: Element, stop: Element | null) => {
      for (let node = element.parentElement; node && node !== stop && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX !== "visible") return true;
      }
      return false;
    };

    /* 1. Desbordamiento horizontal: la regla que más rompe en móvil. */
    const root = dialog?.parentElement ?? document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow > 1) {
      findings.push({ severity: "P0", rule: "desbordamiento-horizontal", detail: `${overflow}px más ancho que el viewport (${vw}px)` });
      const offends = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > vw + 1 || rect.left < -1;
      };
      const culprits = [...(dialog ?? document.body).querySelectorAll("*")]
        .filter((element) => isVisible(element) && offends(element) && !clippedByAncestor(element, dialog))
        .filter((element) => !element.parentElement || !offends(element.parentElement))
        .slice(0, 6);
      for (const element of culprits) {
        const rect = element.getBoundingClientRect();
        findings.push({ severity: "P0", rule: "desborda", detail: `x ${Math.round(rect.left)}→${Math.round(rect.right)} de ${vw}`, target: describe(element) });
      }
    }

    if (touch) {
      /* 2. Inputs por debajo de 16px: iOS Safari hace zoom al enfocarlos. */
      const textInputs = [...scope.querySelectorAll<HTMLElement>("input, select, textarea")].filter((element) => {
        const type = (element.getAttribute("type") || "text").toLowerCase();
        return !["hidden", "file", "checkbox", "radio", "range", "submit", "button"].includes(type) && isVisible(element);
      });
      for (const element of textInputs) {
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < 16) findings.push({ severity: "P1", rule: "zoom-ios", detail: `font-size ${size}px`, target: describe(element) });
      }

      /* 3. Áreas táctiles: 40px es el mínimo que fija `patrones-lista.md`.
         Los controles en línea dentro de una frase quedan fuera (excepción
         «inline» de WCAG 2.5.8): crecerlos haría que las líneas se pisaran. */
      const controls = [...scope.querySelectorAll<HTMLElement>('button, a[href], select, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], summary')]
        .filter((element) => isVisible(element) && !(element as HTMLButtonElement).disabled);
      for (const element of controls) {
        const style = getComputedStyle(element);
        const sentence = element.closest("p");
        if (style.display.startsWith("inline") && sentence && sentence !== element && (sentence.textContent ?? "").trim().length > (element.textContent ?? "").trim().length + 12) continue;
        const rect = element.getBoundingClientRect();
        /* El área táctil puede crecer con un ::after o ::before invisible
           (design-system/hit-area.module.css): cuenta lo que sobresale. */
        let { width, height } = rect;
        for (const pseudo of ["::after", "::before"]) {
          const style = getComputedStyle(element, pseudo);
          if (style.content === "none" || style.position !== "absolute") continue;
          const px = (value: string) => parseFloat(value) || 0;
          width = Math.max(width, rect.width - px(style.left) - px(style.right));
          height = Math.max(height, rect.height - px(style.top) - px(style.bottom));
        }
        if (Math.min(width, height) < 39.5) {
          findings.push({ severity: "P1", rule: "area-tactil", detail: `${Math.round(width)}×${Math.round(height)}px`, target: describe(element) });
        }
      }

      /* 4. Texto truncado cuyo contenido completo solo vive en `title`: con el
         dedo no hay hover y el tooltip nunca aparece. */
      for (const element of scope.querySelectorAll<HTMLElement>("[title]")) {
        if (isVisible(element) && element.scrollWidth > element.clientWidth + 1) {
          findings.push({ severity: "P1", rule: "truncado-solo-title", detail: `title «${element.title.slice(0, 40)}»`, target: describe(element) });
        }
      }
    }

    /* 5. Texto recortado sin elipsis ni forma de leerlo. */
    for (const element of (dialog ?? document.body).querySelectorAll<HTMLElement>("*")) {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
      if (!hasText || !isVisible(element)) continue;
      const style = getComputedStyle(element);
      /* Texto solo para lectores de pantalla: recortado a propósito. */
      if (element.getBoundingClientRect().width <= 1 || style.clip !== "auto" || style.clipPath !== "none") continue;
      if (style.overflowX === "visible" || style.textOverflow === "ellipsis" || element.title) continue;
      if (element.scrollWidth > element.clientWidth + 1) {
        findings.push({ severity: "P2", rule: "texto-recortado", detail: `${element.scrollWidth - element.clientWidth}px ocultos`, target: describe(element) });
      }
    }

    /* 5b. Recortado con elipsis: aceptable en un identificador que se puede
       copiar, no en un importe ni en un plazo. Sin title, lo que queda tras
       los puntos suspensivos no se puede leer de ninguna forma. */
    for (const element of (dialog ?? document.body).querySelectorAll<HTMLElement>("*")) {
      if (!isVisible(element) || element.title) continue;
      const style = getComputedStyle(element);
      if (style.textOverflow !== "ellipsis" || element.scrollWidth <= element.clientWidth + 1) continue;
      const text = (element.textContent ?? "").trim();
      if (/US\$|\d+[.,]\d{2}\b|vence|venció|días?/.test(text) && !/^TX-|^tx-/i.test(text)) {
        findings.push({ severity: "P1", rule: "dato-truncado", detail: `«${text.slice(0, 40)}»`, target: describe(element) });
      }
    }

    /* 6. El modal: se ve entero al abrir y se puede cerrar. */
    if (dialog) {
      const panel = dialog.getBoundingClientRect();
      const close = dialog.querySelector<HTMLElement>('button[aria-label="Cerrar modal"]');
      if (close) {
        const rect = close.getBoundingClientRect();
        if (rect.top < 0 || rect.right > vw || rect.left < 0 || rect.bottom > vh) {
          findings.push({ severity: "P0", rule: "cerrar-fuera-de-pantalla", detail: `botón en x ${Math.round(rect.left)} y ${Math.round(rect.top)}` });
        }
      }
      if (panel.left < -1 || panel.right > vw + 1) {
        findings.push({ severity: "P0", rule: "modal-mas-ancho-que-viewport", detail: `panel x ${Math.round(panel.left)}→${Math.round(panel.right)} de ${vw}; lo que sobresale a la izquierda no se puede alcanzar con scroll` });
      }
      /* En un modal más alto que la pantalla, el botón de cerrar tiene que
         seguir a mano al llegar al final. */
      const backdrop = dialog.parentElement;
      if (close && backdrop && backdrop.scrollHeight > backdrop.clientHeight) {
        const previous = backdrop.scrollTop;
        backdrop.scrollTop = backdrop.scrollHeight;
        const rect = close.getBoundingClientRect();
        backdrop.scrollTop = previous;
        if (rect.bottom < 0 || rect.top > vh) {
          findings.push({ severity: "P1", rule: "cerrar-se-pierde-al-scroll", detail: `modal de ${Math.round(panel.height)}px en ${vh}px` });
        }
      }
    }

    /* Un mismo infractor repetido en cada fila de una lista se cuenta una vez. */
    const seen = new Map<string, (typeof findings)[number] & { count?: number }>();
    for (const finding of findings) {
      const key = `${finding.rule}|${(finding.target ?? "").replace(/ «.*$/, "")}|${finding.detail}`;
      const existing = seen.get(key);
      if (existing) existing.count = (existing.count ?? 1) + 1;
      else seen.set(key, { ...finding });
    }
    return [...seen.values()].map(({ count, ...finding }) => count ? { ...finding, detail: `${finding.detail} ×${count}` } : finding);
  }, options);
}
