// Ponta a ponta num navegador real (F7 §7). Cada teste sobe a própria Fabriquinha numa raiz temporária (e2e/apoio.ts).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    browserName: "chromium",
    // O tamanho em que os protótipos aprovados foram desenhados.
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
