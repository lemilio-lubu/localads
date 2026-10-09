/* Agrega los JSON del barrido en `results/matriz.md`: una tabla superficie ×
   viewport con el recuento de hallazgos por severidad, y debajo el detalle
   agrupado por superficie, con los viewports donde aparece cada hallazgo. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
const order = ["xs", "s1", "s2", "m", "l", "land", "tab", "tabL", "desk", "ref"];

const cases = [];
for (const viewport of order) {
  const directory = path.join(results, viewport);
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    cases.push(JSON.parse(await readFile(path.join(directory, file), "utf8")));
  }
}

const surfaces = [...new Set(cases.map((item) => item.surface))];
const viewports = order.filter((id) => cases.some((item) => item.viewport.id === id));
const cell = (findings) => {
  if (!findings) return "·";
  const count = (severity) => findings.filter((finding) => finding.severity === severity).length;
  const parts = ["P0", "P1", "P2"].map((severity) => count(severity) ? `${severity}:${count(severity)}` : "").filter(Boolean);
  return parts.length ? parts.join(" ") : "✓";
};

const lines = [
  "# Matriz responsive",
  "",
  "`✓` sin hallazgos · `·` no ejecutado o saltado · `P0` roto · `P1` degradado · `P2` pulido",
  "",
  `| superficie | ${viewports.join(" | ")} |`,
  `|---|${viewports.map(() => "---").join("|")}|`,
  ...surfaces.map((surface) => `| ${surface} | ${viewports.map((viewport) => cell(cases.find((item) => item.surface === surface && item.viewport.id === viewport)?.findings)).join(" | ")} |`),
  "",
  "## Detalle",
];

for (const surface of surfaces) {
  const grouped = new Map();
  for (const item of cases.filter((entry) => entry.surface === surface)) {
    for (const finding of item.findings) {
      const key = `${finding.severity} · ${finding.rule} · ${finding.target ?? "(página)"}`;
      const entry = grouped.get(key) ?? { viewports: [], details: new Set() };
      entry.viewports.push(item.viewport.id);
      entry.details.add(finding.detail);
      grouped.set(key, entry);
    }
  }
  if (grouped.size === 0) continue;
  lines.push("", `### ${surface}`, "");
  for (const [key, entry] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- **${key}** — ${entry.viewports.join(", ")} — ${[...entry.details].slice(0, 3).join(" / ")}`);
  }
}

await writeFile(path.join(results, "matriz.md"), `${lines.join("\n")}\n`);
console.log(`matriz escrita en ${path.relative(process.cwd(), path.join(results, "matriz.md"))} (${cases.length} casos)`);
