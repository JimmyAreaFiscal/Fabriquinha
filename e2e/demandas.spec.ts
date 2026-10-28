// Quadro de demandas (T-1289, CA-1 a CA-7): aberto pelo menu, com as rodadas, os PRs, os bloqueios e o trabalho ativo;
// prints a 1440 e 375 px (o último sem rolagem horizontal).
import { projeto } from "./apoio.ts";
import { semearDemandaOciosa, semearDemandas, semearPaginaDaDemanda } from "./demandas-apoio.ts";
import { expect, test } from "./apoio.ts";

const cartao = (pagina: import("@playwright/test").Page, id: string) =>
  pagina.locator(".dm-cartao", { has: pagina.locator(`.id:text-is("${id}")`) });

test("o Auditor abre o quadro pelo menu e vê rodadas, PR, bloqueios e trabalho ativo", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Demandas" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("Demandas");

  // CA-1 e CA-2: as rodadas com a fase; o link do PR só na que tem PR.
  const i206 = cartao(pagina, "I-206");
  await expect(i206).toContainText("Demanda I-206");
  await expect(i206).toContainText("Execução");
  const r1 = i206.locator("li", { hasText: "I-206.R1" });
  await expect(r1).toContainText("Aprovação do PR");
  await expect(r1.getByRole("link")).toHaveAttribute("href", "https://exemplo.com/pr/7");
  await expect(r1.getByRole("link")).toHaveAttribute("target", "_blank");
  const r2 = i206.locator("li", { hasText: "I-206.R2" });
  await expect(r2).toContainText("Desenvolvimento");
  await expect(r2.getByRole("link")).toHaveCount(0);

  // CA-3: o ticket falho e o link da demanda.
  const i207 = cartao(pagina, "I-207");
  await expect(i207).toContainText("ticket falho I-207.T1");
  await expect(i207.getByRole("link", { name: "abrir a demanda →" })).toHaveAttribute("href", "/demandas/I-207");
  // CA-4: a dependência pendente, com o título e a fase da predecessora.
  await expect(i207).toContainText("aguarda I-206 · Demanda I-206 · Execução");
  // CA-5 (e a rodada que aguarda o PR): a decisão do Auditor.
  const i208 = cartao(pagina, "I-208");
  await expect(i208).toContainText("aguarda a decisão do Auditor");
  await expect(i208.getByRole("link", { name: "abrir a demanda →" })).toHaveAttribute("href", "/demandas/I-208");
  await expect(i206).toContainText("aguarda a decisão do Auditor");
  // CA-6: o trabalho ativo.
  await expect(pagina.getByRole("region", { name: "Trabalho ativo" })).toContainText(
    "I-206.T3 Implementação · rodada I-206.R2",
  );

  // Sem rolagem horizontal a 375 px; prints a 1440 e 375 px.
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach(`quadro-${String(largura)}`, {
      body: await pagina.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("CA-7: sem ticket em execução, o trabalho ativo diz que não há trabalho", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandaOciosa(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas`);
  await expect(pagina.getByRole("region", { name: "Trabalho ativo" })).toContainText("Não há trabalho em andamento.");
});

test("o quadro do projeto mostra só as demandas dele", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/outro/demandas`);
  await expect(pagina.locator(".dm-cartao")).toHaveCount(0);
  await pagina.goto(`${fabriquinha.base}/projects/loja/demandas`);
  await expect(pagina.locator(".dm-cartao")).toHaveCount(3);
});

test("a página da demanda mostra rodadas, tickets, decisões, evidências e o encerramento, só em leitura", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearPaginaDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-210`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("Demanda I-210");

  // CA-8 e CA-9: tickets na rodada ou globais, sempre pelo endereço público.
  const r1 = pagina.locator("#I-210\\.R1");
  await expect(r1).toContainText("Aprovação do PR");
  await expect(r1).toContainText("nota 4");
  await expect(r1.getByRole("link", { name: /PR #7/ })).toHaveAttribute("href", "https://exemplo.com/pr/7");
  await expect(r1.locator("li", { hasText: "I-210.T1" })).toContainText("Concluído");
  // CA-11: a decisão com o motivo escrito, no ticket.
  await expect(r1.locator("li", { hasText: "I-210.T2" })).toContainText("falta teste do caminho de erro");
  const r2 = pagina.locator("#I-210\\.R2");
  await expect(r2).toContainText("Sessão de ajustes");
  await expect(r2.locator("li", { hasText: "I-210.T5" })).toContainText("Falhou");
  await expect(r2).toContainText("o teste de erro não passou");
  await expect(pagina.getByRole("region", { name: "Tickets globais" })).toContainText("I-210.T6");
  await expect(pagina.getByRole("region", { name: "Tickets globais" })).not.toContainText("I-210.T1");
  await expect(pagina.locator("main")).not.toContainText(/\bT-\d+\b/);

  // CA-13: a dependência com a fase e o link.
  const dependencias = pagina.getByRole("region", { name: "Dependências" });
  await expect(dependencias).toContainText("Execução");
  await expect(dependencias.getByRole("link", { name: "I-211" })).toHaveAttribute("href", "/demandas/I-211");

  // CA-12: integração concluída, limpeza falhou, nada de "nada foi integrado".
  const encerramento = pagina.getByRole("region", { name: "Encerramento final" });
  await expect(encerramento).toContainText("Integração concluída");
  await expect(encerramento).toContainText("Limpeza falhou");
  await expect(encerramento).not.toContainText(/nada foi integrado/i);

  // Só leitura (I-238 traz as ações) e a tela da issue não usa `.dm-` (CA-33).
  await expect(pagina.locator("main button")).toHaveCount(0);

  // CA-10: clicar no print abre a imagem na caixa.
  await pagina.getByRole("link", { name: "print.png" }).click();
  await expect(pagina.locator("dialog[open] img")).toBeVisible();
  await pagina.keyboard.press("Escape");

  // CA-32: sem rolagem horizontal a 375 px; prints a 1440 e 375 px.
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach(`demanda-${String(largura)}`, {
      body: await pagina.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("CA-31: a demanda que não existe mostra o aviso e o link ao quadro", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-999`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("Demanda não encontrada");
  await pagina.getByRole("link", { name: "Ir para as demandas" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas`);
});

test("o cartão do quadro leva à página da demanda", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas`);
  await pagina.getByRole("link", { name: "abrir a demanda →" }).first().click();
  await expect(pagina).toHaveURL(/\/demandas\/I-\d+$/);
  await pagina.getByRole("link", { name: "← Demandas" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas`);
});
