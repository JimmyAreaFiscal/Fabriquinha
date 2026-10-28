// Início (comparacao-sdlc §9.1, "Board com issue"): a frase do mês, o que aguarda o Auditor, o que roda e o board só com
// as demandas em andamento, com as colunas por fase da demanda e, na execução, por fase da rodada; prints a 1440 e
// 375 px, sem rolagem horizontal da página (abaixo de 1320 px o board rola dentro dele).
import type { Locator, Page } from "@playwright/test";
import { abrir } from "../src/persistencia/banco.ts";
import { fotografar, projeto } from "./apoio.ts";
import { semearDemandaConcluida, semearDemandaOciosa, semearDemandas } from "./demandas-apoio.ts";
import { expect, test } from "./apoio.ts";

/** A sessão autônoma do I-206.T3 com a execução aberta: roda. */
function sessaoRodando(raiz: string): void {
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO sessao VALUES ('s-i206-t3', 'I-206', 3, 'autonomo', 'c1');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('x1', 's-i206-t3', '${new Date().toISOString()}', NULL, 0);
  `);
  banco.close();
}

const coluna = (pagina: Page, nome: string): Locator =>
  pagina.locator(".coluna", { has: pagina.locator(".coluna-cabeca", { hasText: new RegExp(`^${nome} \\d`) }) });

test("o Início mostra o que aguarda, o que roda e o board das demandas em andamento, e se atualiza sozinho", async ({
  pagina,
  fabriquinha,
}, info) => {
  const erros: string[] = [];
  pagina.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });
  pagina.on("pageerror", (e) => erros.push(e.message));
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  semearDemandaConcluida(fabriquinha.raiz);
  sessaoRodando(fabriquinha.raiz);
  const nav = pagina.getByRole("navigation", { name: "Páginas" });
  await nav.getByRole("link", { name: "Métricas" }).click();
  await nav.getByRole("link", { name: /^Início/ }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("Início");
  await expect(pagina.locator(".frase-mes")).toContainText("todos os projetos:");
  await expect(pagina.locator(".frase-mes").getByRole("link", { name: "Métricas →" })).toHaveAttribute(
    "href",
    "/metrics",
  );

  // Aguarda você: o gate do PR da I-206.R1, o ticket falho da I-207 e o gate da I-208; a navegação conta o mesmo.
  const aguarda = pagina.getByRole("region", { name: "Aguarda você" });
  await expect(aguarda.locator(".contador")).toHaveText("3");
  await expect(nav.getByRole("link", { name: /^Início/ }).locator(".contador")).toHaveText("3");
  await expect(aguarda.locator(".decisao-motivo")).toHaveText(["Gate do PR", "Falhou", "Gate da demanda"]);
  await expect(aguarda.locator(".decisao").first()).toContainText("PR #7 aberto; aguarda a sua revisão no PR");

  // Rodando: a sessão do I-206.T3.
  const rodando = pagina.getByRole("region", { name: "Rodando" });
  await expect(rodando.locator(".rodando-linha")).toHaveCount(1);
  await expect(rodando.locator(".rodando-linha")).toContainText("I-206.T3");

  // Board: as rodadas da execução nas colunas da fase delas; a concluída I-217 não aparece.
  const regiaoDoBoard = pagina.getByRole("region", { name: "Board" });
  await expect(regiaoDoBoard).toContainText("3 demandas em andamento");
  await expect(regiaoDoBoard).not.toContainText("I-217");
  const pr = coluna(pagina, "Aprovação do PR");
  await expect(pr.locator(".cartao")).toHaveCount(1);
  await expect(pr.locator(".cartao")).toContainText("I-206.R1");
  await expect(pr.locator(".cartao")).toContainText("aguarda você · gate do PR");
  const desenvolvimento = coluna(pagina, "Desenvolvimento");
  await expect(desenvolvimento.locator(".cartao .id")).toHaveText(["I-206.R2", "I-207.R1"]);
  await expect(desenvolvimento.locator(".cartao").first()).toContainText(
    "I-206.T3 implementação · autônoma · em execução",
  );
  await expect(desenvolvimento.locator(".cartao").first()).toContainText("em execução ·");
  await expect(desenvolvimento.locator(".cartao").last()).toContainText("aguarda você · falha");
  await expect(desenvolvimento.locator(".cartao").last()).toContainText("bloqueada por I-206");
  await expect(desenvolvimento.locator(".cartao").last().locator(".pill .mono")).toHaveText("I-206");
  await expect(coluna(pagina, "Aprovação da demanda").locator(".cartao")).toContainText(
    "aguarda você · gate da demanda",
  );
  await expect(pagina.locator(".coluna-gate")).toHaveCount(3);

  // Nenhuma largura rola a página na horizontal nem quebra um endereço (I-206, I-206.R1, I-206.T3). A 1440 e a 1320 px
  // as 11 colunas cabem inteiras, sem texto cortado; abaixo disso (375 px) o board rola dentro dele.
  const board = pagina.locator(".board-etapas");
  for (const largura of [1440, 1320, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const rola = await board.evaluate((etapas) => etapas.scrollWidth > etapas.clientWidth);
    expect(rola, `o board rola a ${String(largura)} px`).toBe(largura < 1320);
    if (largura >= 1320) {
      const ultima = await coluna(pagina, "Encerramento da demanda").boundingBox();
      const caixa = await board.boundingBox();
      expect(Number(ultima?.x) + Number(ultima?.width)).toBeLessThanOrEqual(Number(caixa?.x) + Number(caixa?.width));
      expect(
        await board.evaluate((etapas) =>
          [...etapas.querySelectorAll("*")]
            .filter((e) => e.scrollWidth > e.clientWidth)
            .map((e) => `${e.className} ${String(e.scrollWidth)}/${String(e.clientWidth)}`),
        ),
        "texto cortado no board",
      ).toEqual([]);
    }
    expect(
      await board.evaluate((etapas) =>
        [...etapas.querySelectorAll(".id, .mono, .endereco")]
          .filter((e) => e.getClientRects().length > 1)
          .map((e) => e.textContent),
      ),
      "endereço quebrado no board",
    ).toEqual([]);
    if (largura !== 1320) await fotografar(pagina, info, `inicio-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  // Sem recarregar, a demanda nova aparece na próxima atualização.
  semearDemandaOciosa(fabriquinha.raiz);
  await expect(regiaoDoBoard).toContainText("4 demandas em andamento", { timeout: 10_000 });
  await expect(coluna(pagina, "Aprovação da demanda").locator(".cartao .id")).toHaveText(["I-208", "I-209"]);

  // O cartão do que aguarda leva à página da demanda, e ela volta ao Início.
  await aguarda.getByRole("link", { name: /Gate do PR/ }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas/I-206`);
  await expect(nav.getByRole("link", { name: /^Início/ })).toHaveAttribute("aria-current", "page");
  await pagina.getByRole("link", { name: "← Início" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  await coluna(pagina, "Desenvolvimento").locator(".cartao").last().click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas/I-207`);
  expect(erros).toEqual([]);
});

test("sem nada em andamento, o Início diz que nada aguarda nem roda e mostra as colunas vazias", async ({ pagina }) => {
  await expect(pagina.getByText("Nada aguarda você agora.")).toBeVisible();
  await expect(pagina.getByText("Nenhuma sessão rodando.")).toBeVisible();
  await expect(pagina.getByRole("region", { name: "Board" })).toContainText("0 demandas em andamento");
  await expect(pagina.locator(".coluna-vazia")).toHaveCount(11);
});
