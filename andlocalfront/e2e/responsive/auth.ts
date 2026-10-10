import { expect, type Page } from "@playwright/test";

export type Role = "public" | "admin" | "gestor" | "prepago" | "flex";

/* Usuarios del seed (`andlocalback/prisma/seed.cjs`), todos con la misma
   contraseña de demo. */
const DEMO_PASSWORD = "1234";

/* Login por la interfaz en cada test. No se reutiliza `storageState`: el
   refresh token rota en cada uso, así que un estado guardado caduca en cuanto
   lo consume el primer test. */
export async function login(page: Page, role: Role) {
  if (role === "public") return;
  await page.goto("/");
  await page.locator('input[name="username"]').fill(role);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).not.toHaveURL(/\/$/, { timeout: 15_000 });
}
