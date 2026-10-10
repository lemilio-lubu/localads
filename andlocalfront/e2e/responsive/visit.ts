import { expect, type Page } from "@playwright/test";
import { login } from "./auth";
import type { Surface } from "./surfaces";

/* Hora congelada: «actualizado a las …» y «vence en N días» salen del reloj, y
   sin esto la línea base de escritorio cambiaría en cada ejecución. */
export const FIXED_NOW = new Date("2026-10-09T10:00:00-05:00");

/* Lleva la página a la superficie lista para medir. Devuelve `false` si es un
   modal que los datos actuales no permiten abrir. */
export async function visit(page: Page, surface: Surface) {
  await page.clock.setFixedTime(FIXED_NOW);
  await login(page, surface.role);
  if (surface.prepare) {
    await surface.prepare(page);
    await page.goto(surface.path);
  } else if (surface.role === "public" || new URL(page.url()).pathname !== surface.path) await page.goto(surface.path);
  await surface.ready(page);
  if (surface.interact) await surface.interact(page);
  /* El indicador de desarrollo de Next no es parte del producto: ni se mide
     ni sale en las capturas. */
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  /* Deja terminar la hidratación: un clic antes cae en un botón sin handler. */
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  if (!surface.open) return true;
  if (!await surface.open(page)) return false;
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
  /* Un margen para que el contenido del modal termine de cargar sus datos. */
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  return true;
}
