// Métricas (F7 §4.4, item 2): o mês em foco escolhido com um clique continua o mesmo ao trocar só o projeto, e volta
// ao último mês quando o período novo não o contém mais; a seção de cada Etapa acompanha o mês em foco.
import type { Locator } from "@playwright/test";
import { abrirBancoDaFabriquinha } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { expect, SECOES_DE_ETAPA, test } from "../apoio.ts";

test("trocar o projeto mantém o mês em foco; um período que não o contém leva o foco ao último mês", async ({
  page,
  pagina,
  fabriquinha,
}) => {
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  banco.exec(
    ["loja", "site"]
      .map(
        (nome) => `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
          VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '${nome}');`,
      )
      .join("\n"),
  );
  banco.close();
  await pagina.goto(`${fabriquinha.base}/metrics`);
  const meses = page.locator(".mes-btn");
  await expect(meses).toHaveCount(12);
  const focado = page.locator('.mes-btn[aria-pressed="true"]');
  await expect(focado).toHaveAttribute("data-mes", String(await meses.last().getAttribute("data-mes")));

  // Uma seção por Etapa, com o título e o rótulo das Métricas dela, no mês em foco.
  const etapas = page.locator("section.etapa-metricas");
  const subtituloDasEtapas = page.locator(".titulo-secao", { hasText: "Por etapa" }).locator(".muted");
  const confereAsEtapas = async (mes: Locator) => {
    await expect(etapas).toHaveCount(SECOES_DE_ETAPA.length);
    await expect(etapas.getByRole("heading", { level: 3 })).toHaveText(SECOES_DE_ETAPA.map(([titulo]) => titulo));
    for (const [titulo, rotulos] of SECOES_DE_ETAPA)
      await expect(page.getByRole("region", { name: titulo, exact: true }).locator(".rotulo")).toHaveText(rotulos);
    await expect(subtituloDasEtapas).toContainText(
      `${(await mes.locator("span").innerText()).trim()} · as Métricas de Sucesso`,
    );
  };
  await confereAsEtapas(focado);

  const escolhido = String(await meses.nth(8).getAttribute("data-mes"));
  await meses.nth(8).click();
  await expect(focado).toHaveAttribute("data-mes", escolhido);
  await confereAsEtapas(focado);

  // A régua de agora é marcada: some quando a página se redesenha com o projeto novo.
  await page.locator(".regua").evaluate((el) => {
    el.setAttribute("data-antes", "");
  });
  await page.getByLabel("Projeto").selectOption("site");
  await expect(page.locator(".regua[data-antes]")).toHaveCount(0);
  await expect(page.getByLabel("Projeto")).toHaveValue("site");
  await expect(focado).toHaveAttribute("data-mes", escolhido);
  await confereAsEtapas(focado);

  // O fim do período antes do mês em foco: o foco vai para o último mês do período novo.
  const ate = String(await meses.nth(5).getAttribute("data-mes"));
  await page.getByLabel("Até").selectOption(ate);
  await expect(meses).toHaveCount(6);
  await expect(focado).toHaveAttribute("data-mes", ate);
  await confereAsEtapas(focado);
});
