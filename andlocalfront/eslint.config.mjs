import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";


/* Atomic design: cada nivel solo importa de los niveles inferiores, y nada
   dentro de components/ habla con la API (eso vive en features/ y en las vistas). */
const noApi = { group: ["**/lib/*-api", "**/lib/use-*", "**/lib/transaction-realtime", "**/features/**"], message: "components/ no accede a datos: recibe props. Lo conectado va en features/ o en la vista." };
const above = (levels) => ({ group: levels.map((level) => `**/${level}/*`), message: "Atomic design: un nivel solo importa de los niveles inferiores." });
const atomicLayer = (folder, forbidden) => ({
  files: [`app/components/${folder}/**/*.{ts,tsx}`],
  rules: { "no-restricted-imports": ["error", { patterns: [noApi, ...(forbidden.length ? [above(forbidden)] : [])] }] },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  atomicLayer("atoms", ["molecules", "organisms", "templates"]),
  atomicLayer("molecules", ["organisms", "templates"]),
  atomicLayer("organisms", ["templates"]),
  atomicLayer("templates", []),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
