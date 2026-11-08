// Ponta a ponta num navegador real (F7 §7). Cada teste sobe a própria Fabriquinha numa raiz temporária (e2e/apoio.ts).
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// A saída dos testes fica fora da worktree: o Sonar varre a worktree enquanto o E2E roda e, dentro dela, lia uma pasta
// que o Playwright acabava de apagar (ENOENT). Uma pasta por worktree, para execuções em worktrees diferentes não se apagarem.
const pastaDaSaida = join(
  tmpdir(),
  `playwright-saida-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16)}`,
);

export default defineConfig({
  testDir: "e2e",
  outputDir: pastaDaSaida,
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
