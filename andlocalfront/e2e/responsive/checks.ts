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
         Los enlaces dentro de un párrafo quedan fuera (excepción «inline» de
         WCAG 2.5.8): crecerlos rompería el interlineado. */
      const controls = [...scope.querySelectorAll<HTMLElement>('button, a[href], select, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], summary')]
        .filter((element) => isVisible(element) && !(element as HTMLButtonElement).disabled);
      for (const element of controls) {
        const style = getComputedStyle(element);
        if (style.display === "inline" && element.parentElement && /^(P|SPAN|SMALL|LI)$/.test(element.parentElement.tagName)) continue;
        const rect = element.getBoundingClientRect();
        if (Math.min(rect.width, rect.height) < 40) {
          findings.push({ severity: "P1", rule: "area-tactil", detail: `${Math.round(rect.width)}×${Math.round(rect.height)}px`, target: describe(element) });
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
      if (panel.height > vh) {
        findings.push({ severity: "P2", rule: "modal-mas-alto-que-viewport", detail: `${Math.round(panel.height)}px en ${vh}px (el botón de cerrar se va con el scroll)` });
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
