import { defineConfig, devices } from "@playwright/test";
import { desktopBaseline, viewports } from "./e2e/responsive/viewports";

/* Suite responsive. Necesita el backend en :3001 y el frontend en :3000 ya
   arrancados; conviene que el backend apunte a una copia de la base de datos
   (`DATABASE_URL="file:./e2e.db"`), no a `dev.db`. */
export default defineConfig({
  testDir: "e2e/responsive",
  outputDir: "e2e/responsive/results/test-output",
  snapshotPathTemplate: "e2e/responsive/__baseline__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.RESPONSIVE_BASE_URL ?? "http://localhost:3000",
    reducedMotion: "reduce",
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
    deviceScaleFactor: 1,
  },
  projects: [
    ...viewports.map((viewport) => ({
      name: viewport.id,
      testMatch: /responsive\.spec\.ts/,
      use: {
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.touch,
        hasTouch: viewport.touch,
      },
    })),
    ...desktopBaseline.map((viewport) => ({
      name: `baseline-${viewport.id}`,
      testMatch: /desktop-baseline\.spec\.ts/,
      use: { viewport: { width: viewport.width, height: viewport.height } },
    })),
  ],
});
