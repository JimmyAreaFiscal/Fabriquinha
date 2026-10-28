// Projeto (F7 §4.4; I-247 CA-5): /projects abre o primeiro projeto e depois o último visto, sem Registrar necessidade
// nem lista de issues; o heatmap e a simulação do projeto continuam; prints a 1440 e 375 px sem rolagem horizontal.
import type { TestInfo } from "@playwright/test";
import { abrir } from "../src/persistencia/banco.ts";
import { expect, fotografar, projeto, test } from "./apoio.ts";

test("CA-5: o projeto sem Registrar necessidade nem issues; o heatmap e a simulação do projeto abrem", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  projeto(fabriquinha.raiz);
  const banco = abrir(fabriquinha.raiz);
  banco.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('site', '/nao/existe/site', 'main', 'github', 'site')`);
  banco.close();
  const erros: string[] = [];
  pagina.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });
  pagina.on("pageerror", (e) => erros.push(e.message));

  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Projetos" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.getByRole("heading", { name: "Projeto" })).toBeVisible();
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveCount(6);
  await expect(pagina.getByRole("button", { name: /Registrar necessidade/ })).toHaveCount(0);
  await expect(pagina.locator("main")).not.toContainText(/issue|Arquivar concluídas|Mostrar concluídas/i);

  // O seletor troca de projeto, e /projects volta ao último visto.
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("site");
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
  await pagina.goto(`${fabriquinha.base}/projects`);
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("loja");

  const abas = pagina.getByRole("navigation", { name: "Abas do projeto" });
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    await expect(abas.getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `projeto-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  await abas.getByRole("link", { name: "Heatmap" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja/heatmap`);
  await expect(pagina.locator("[data-arvore]")).toBeVisible();

  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Simulação" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/simulation/loja`);
  await expect(pagina.getByRole("heading", { name: "Simulação" })).toBeVisible();
  expect(erros).toEqual([]);
});
