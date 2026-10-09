import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { measure } from "./checks";
import { blockedTaps, surfaces } from "./surfaces";
import { viewports } from "./viewports";
import { visit } from "./visit";

/* Recorre superficie × viewport: captura, mide y deja un JSON por caso en
   `e2e/responsive/results/<viewport>/`. Con RESPONSIVE_AUDIT=1 solo recoge
   (el barrido de auditoría); sin él, cualquier P0 o P1 hace fallar el test. */
const RESULTS = path.join(__dirname, "results");
const audit = Boolean(process.env.RESPONSIVE_AUDIT);

for (const surface of surfaces) {
  test(surface.id, async ({ page }, testInfo) => {
    test.skip(Boolean(surface.mutates) && !process.env.RESPONSIVE_MUTATIONS, "escribe en la base de datos: RESPONSIVE_MUTATIONS=1");
    const viewport = viewports.find((item) => item.id === testInfo.project.name)!;

    const opened = await visit(page, surface);
    test.skip(!opened, "los datos actuales no permiten abrir este modal");

    const findings = [
      ...blockedTaps(page).map((target) => ({ severity: "P0" as const, rule: "control-tapado", detail: "otro elemento intercepta el toque", target })),
      ...await measure(page, { touch: viewport.touch, modal: Boolean(surface.open) }),
    ];

    const directory = path.join(RESULTS, viewport.id);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${surface.id}.png`), fullPage: true });
    if (surface.open) {
      /* El backdrop es el que hace scroll, así que la captura de página
         completa no llega al final de un modal largo. */
      const scrolled = await page.getByRole("dialog").evaluate((dialog) => {
        const backdrop = dialog.parentElement!;
        if (backdrop.scrollHeight <= backdrop.clientHeight) return false;
        backdrop.scrollTop = backdrop.scrollHeight;
        return true;
      });
      if (scrolled) await page.screenshot({ path: path.join(directory, `${surface.id}--fin.png`) });
    }
    await writeFile(path.join(directory, `${surface.id}.json`), JSON.stringify({ surface: surface.id, viewport, findings }, null, 2));

    if (!audit) {
      const blocking = findings.filter((finding) => finding.severity !== "P2");
      expect(blocking, blocking.map((finding) => `${finding.severity} ${finding.rule} ${finding.target ?? ""} ${finding.detail}`).join("\n")).toEqual([]);
    }
  });
}
