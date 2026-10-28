// Projeto (F7 §4.4): /projects abre o primeiro projeto e depois o último visto; a aba Demandas tem os cards do mês e a
// lista das demandas do projeto, com a linha do tempo das fases, as rodadas da execução, a gaveta de tickets, os
// filtros lembrados e o Arquivar concluídas; o heatmap e a simulação do projeto continuam; prints a 1440 e 375 px sem
// rolagem horizontal.
import type { TestInfo } from "@playwright/test";
import { abrir } from "../src/persistencia/banco.ts";
import { semearDemandaConcluida, semearDemandaOciosa, semearDemandas } from "./demandas-apoio.ts";
import { expect, fotografar, projeto, test } from "./apoio.ts";

test("a aba Demandas: a lista com as rodadas, a gaveta, os filtros lembrados e o Arquivar concluídas", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  semearDemandaConcluida(fabriquinha.raiz);
  const erros: string[] = [];
  pagina.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });
  pagina.on("pageerror", (e) => erros.push(e.message));

  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Projetos" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja`);
  const abas = pagina.getByRole("navigation", { name: "Abas do projeto" });
  await expect(abas.getByRole("link", { name: "Demandas" })).toHaveAttribute("aria-current", "page");
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveCount(6);
  const contagem = pagina.locator(".contagem");
  await expect(contagem).toHaveText("3 em andamento · 1 concluída · 0 arquivadas · 0 canceladas");

  // As em andamento, das mais novas às mais antigas, cada uma com a fase atual na linha do tempo.
  const linhas = pagina.locator(".pista-item");
  await expect(linhas.locator(".titulo")).toHaveText(["Demanda I-208", "Demanda I-207", "Demanda I-206"]);
  const i208 = pagina.locator('[data-demanda="I-208"]');
  await expect(i208.getByRole("list", { name: "Fases da demanda I-208" }).locator('[aria-current="step"]')).toHaveText(
    "Aprovação da demanda",
  );
  await expect(i208).toHaveClass(/aguarda/);
  const i207 = pagina.locator('[data-demanda="I-207"]');
  await expect(i207).toHaveClass(/falha/);
  await expect(i207.locator(".bloqueia")).toHaveText("bloqueada por I-206");

  // Na execução, uma sub-linha por rodada com a fase dela e o PR.
  const i206 = pagina.locator('[data-demanda="I-206"]');
  const rodadas = i206.locator(".pista-rodada");
  await expect(rodadas).toHaveCount(2);
  await expect(rodadas.nth(0)).toContainText("I-206.R1");
  await expect(rodadas.nth(0).getByRole("link", { name: "PR #7" })).toHaveAttribute("href", "https://exemplo.com/pr/7");
  await expect(rodadas.nth(0).locator('[aria-current="step"]')).toHaveText("Aprovação do PR");
  await expect(rodadas.nth(1).locator('[aria-current="step"]')).toHaveText("Desenvolvimento");
  await expect(rodadas.nth(1).getByRole("list")).toHaveClass(/rodando/);

  // A gaveta: aberta porque aguarda o PR; o clique na linha a fecha e o ▼ a abre de novo.
  const tickets = i206.locator(".gaveta tr");
  await expect(tickets).toHaveCount(3);
  await expect(tickets.nth(2)).toContainText("implementação");
  await expect(tickets.nth(2)).toContainText("I-206.T3");
  await expect(tickets.nth(2)).toContainText("em execução");
  await expect(tickets.nth(2)).toContainText("padrão do pi");
  await i206.locator(".pista-linha .sub").click();
  await expect(tickets.first()).toBeHidden();
  await i206.getByRole("button", { name: "Tickets de I-206" }).click();
  await expect(tickets.first()).toBeVisible();

  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `projeto-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  // Mostrar concluídas traz a I-217 e fica lembrado ao voltar à página.
  await pagina.getByLabel("Mostrar concluídas").check();
  await expect(linhas).toHaveCount(4);
  await expect(pagina.locator('[data-demanda="I-217"]')).toContainText(/concluída em \d\d\/\d\d/);
  await pagina.reload();
  await expect(pagina.getByLabel("Mostrar concluídas")).toBeChecked();
  await expect(linhas).toHaveCount(4);

  // Arquivar concluídas confirma, tira a I-217 da lista, e ela volta com Mostrar arquivadas.
  await pagina.getByRole("button", { name: "Arquivar concluídas" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Arquivar concluídas" });
  await expect(caixa).toContainText(
    '1 demanda concluída de loja será arquivada. Ela sai desta lista e continua acessível em "Mostrar arquivadas". Nada é apagado.',
  );
  await caixa.getByRole("button", { name: "Arquivar" }).click();
  await expect(caixa).toBeHidden();
  await expect(contagem).toHaveText("3 em andamento · 0 concluídas · 1 arquivada · 0 canceladas");
  await expect(linhas).toHaveCount(3);
  await expect(pagina.getByRole("button", { name: "Arquivar concluídas" })).toBeDisabled();
  await pagina.getByLabel("Mostrar arquivadas").check();
  await expect(pagina.locator('[data-demanda="I-217"]')).toContainText(/arquivada em \d\d\/\d\d/);
  expect(erros).toEqual([]);
});

test("ticket sem título mostra a etapa, Ajustes do PR que não houve não quebra a linha, e a lista se atualiza sozinha", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  semearDemandaConcluida(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  const i206 = pagina.locator('[data-demanda="I-206"]');
  await expect(i206.locator(".gaveta .titulo-cel")).toHaveText(["Implementar", "Encerrar a rodada", "Implementar"]);
  await expect(pagina.locator("main")).not.toContainText("sem título");

  // A R1 aguarda o PR: Ajustes do PR ainda pode vir, fica pendente. A I-217 concluiu sem ele: a linha passa contínua.
  const ajustes = (linha: string) => pagina.getByRole("list", { name: linha }).getByRole("listitem").nth(8);
  await expect(ajustes("Fases da rodada I-206.R1")).toHaveClass("passo");
  await pagina.getByLabel("Mostrar concluídas").check();
  await expect(ajustes("Fases da demanda I-217")).toHaveClass("passo pulada");

  // Sem recarregar: a demanda nova aparece no próximo redesenho, a cada 5 s.
  const linhas = pagina.locator(".pista-item");
  await expect(linhas).toHaveCount(4);
  semearDemandaOciosa(fabriquinha.raiz);
  await expect(linhas).toHaveCount(5, { timeout: 10_000 });
  await expect(pagina.locator(".contagem")).toHaveText("4 em andamento · 1 concluída · 0 arquivadas · 0 canceladas");
});

test("Mostrar canceladas traz a cancelada, apagada, com as rodadas onde pararam", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  const banco = abrir(fabriquinha.raiz);
  banco.exec("UPDATE demanda SET fase = 'cancelada' WHERE id = 'I-207'");
  banco.close();
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.locator(".contagem")).toHaveText("2 em andamento · 0 concluídas · 0 arquivadas · 1 cancelada");
  const i207 = pagina.locator('[data-demanda="I-207"]');
  await expect(i207).toHaveCount(0);
  await pagina.getByLabel("Mostrar canceladas").check();
  await expect(i207).toContainText(/cancelada em \d\d\/\d\d/);
  await expect(i207).toHaveClass(/cancelada/);
  await expect(i207.locator(".pista-rodada").getByRole("list")).toHaveClass(/cancelada/);
});

test("/projects volta ao último visto; o heatmap e a simulação do projeto abrem", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  const banco = abrir(fabriquinha.raiz);
  banco.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('site', '/nao/existe/site', 'main', 'github', 'site')`);
  banco.close();
  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Projetos" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.getByRole("button", { name: /Registrar necessidade/ })).toHaveCount(0);
  await expect(pagina.locator(".vazio")).toHaveText("Nenhuma demanda.");

  // O seletor troca de projeto, e /projects volta ao último visto.
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("site");
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
  await pagina.goto(`${fabriquinha.base}/projects`);
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("loja");

  const abas = pagina.getByRole("navigation", { name: "Abas do projeto" });
  await abas.getByRole("link", { name: "Heatmap" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja/heatmap`);
  await expect(pagina.locator("[data-arvore]")).toBeVisible();

  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Simulação" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/simulation/loja`);
  await expect(pagina.getByRole("heading", { name: "Simulação" })).toBeVisible();
});
