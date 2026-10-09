import { expect, test } from "@playwright/test";
import { surfaces } from "./surfaces";
import { visit } from "./visit";

/* La garantía de que corregir el móvil no toca el escritorio: capturas de
   1280 y 1440 tomadas antes de cambiar ningún CSS. Si una corrección las
   altera, el test falla y la corrección se reescribe dentro de su media query.
   Regenerarlas (--update-snapshots) solo cuando el cambio de escritorio se
   haya pedido expresamente. */
for (const surface of surfaces.filter((item) => !item.mutates)) {
  test(surface.id, async ({ page }) => {
    const opened = await visit(page, surface);
    test.skip(!opened, "los datos actuales no permiten abrir este modal");
    await expect(page).toHaveScreenshot(`${surface.id}.png`, { fullPage: true, animations: "disabled" });
  });
}
