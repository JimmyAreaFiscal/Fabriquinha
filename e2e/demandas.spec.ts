// Quadro de demandas (T-1289, CA-1 a CA-7): aberto pelo menu, com as rodadas, os PRs, os bloqueios e o trabalho ativo;
// prints a 1440 e 375 px (o último sem rolagem horizontal).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projeto } from "./apoio.ts";
import {
  semearDemandaConcluida,
  semearDemandaOciosa,
  semearDemandas,
  semearGateDaDemanda,
  semearPaginaDaDemanda,
  semearPlanejamento,
  semearPrDaRodada,
  semearTicketAberto,
} from "./demandas-apoio.ts";
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

  // Só os botões do gate do PR da rodada (R1 em Aprovação do PR) o Reabrir do T5 falho e os três do cancelamento; a tela da issue não usa `.dm-` (CA-33).
  await expect(pagina.locator("main button")).toHaveCount(6);

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

const fase = (pagina: import("@playwright/test").Page) => pagina.locator(".dm-cabeca .pill");

test("CA-14 a CA-16: o gate da demanda aprova, recusa sem motivo não envia e recusa com motivo", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearGateDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-214`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await expect(pagina.locator(".dm-gate-titulo", { hasText: "Aprovação da demanda" })).toBeVisible();
  await info.attach("gate-1440", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });
  await pagina.setViewportSize({ width: 375, height: 900 });
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Recusar" })).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("gate-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

  // CA-15: motivo vazio, a mensagem junto ao campo e a fase não muda.
  await pagina.getByRole("button", { name: "Recusar" }).click();
  await expect(pagina.locator("#motivo-decisao-erro")).toHaveText("O motivo é obrigatório para recusar.");
  await expect(fase(pagina)).toHaveText("Aprovação da demanda");

  // CA-16: com o motivo, a fase devolvida e os botões somem.
  await pagina.getByLabel(/Motivo/).fill("escopo incompleto");
  await pagina.getByRole("button", { name: "Recusar" }).click();
  await expect(pagina.getByRole("button", { name: "Recusar" })).toHaveCount(0);
  await expect(fase(pagina)).not.toHaveText("Aprovação da demanda");
});

test("CA-17 a CA-19: o gate do planejamento aprova e reprova, e a reprovação pede o motivo", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearPlanejamento(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-212`);
  await pagina.getByRole("button", { name: "Reprovar planejamento" }).click();
  await expect(pagina.locator("#motivo-planejamento-decisao-erro")).toHaveText("O motivo é obrigatório para recusar.");
  await expect(fase(pagina)).toHaveText("Aprovação do planejamento");
  await pagina.getByLabel(/Motivo/).fill("falta o caso de erro");
  await pagina.getByRole("button", { name: "Reprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Reprovar planejamento" })).toHaveCount(0);
  await expect(fase(pagina)).not.toHaveText("Aprovação do planejamento");

  await pagina.goto(`${fabriquinha.base}/demandas/I-213`);
  await pagina.getByRole("button", { name: "Aprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar planejamento" })).toHaveCount(0);
  await expect(fase(pagina)).not.toHaveText("Aprovação do planejamento");
});

test("CA-30: a página desatualizada mostra a orientação do servidor e a fase atual", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearGateDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-214`);
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toBeVisible();
  // Outra aba aprova a demanda.
  await pagina.evaluate(() =>
    fetch("/api/demandas/I-214/decisao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aprovado: true }),
    }),
  );
  await pagina.getByRole("button", { name: "Aprovar" }).click();
  await expect(pagina.locator("[data-aviso]")).not.toBeEmpty();
  await expect(pagina.locator("[data-aviso]")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await expect(fase(pagina)).not.toHaveText("Aprovação da demanda");
});

test("CA-14: Aprovar a demanda mostra a fase devolvida e os botões somem", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearGateDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-214`);
  await pagina.getByRole("button", { name: "Aprovar" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await expect(fase(pagina)).not.toHaveText("Aprovação da demanda");
});

test("CA-20 e CA-21: aprovar o PR pede a nota e, com a nota, mostra-a na rodada", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearPrDaRodada(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-215`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  // O gate do PR vem depois da lista de tickets da rodada.
  expect(await pagina.locator(".dm-rodada .dm-tickets ~ .dm-gate").count()).toBe(1);
  await expect(pagina.locator(".dm-gate-titulo", { hasText: "Aprovação do PR" })).toBeVisible();
  await info.attach("gate-pr-1440", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });
  await pagina.setViewportSize({ width: 375, height: 900 });
  await expect(pagina.getByRole("button", { name: "Aprovar PR" })).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Reprovar PR" })).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("gate-pr-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

  await pagina.getByRole("button", { name: "Aprovar PR" }).click();
  await expect(pagina.locator("#nota-I-215\\.R1-erro")).toHaveText("Escolha a nota de 1 a 5.");
  await expect(pagina.getByRole("button", { name: "Aprovar PR" })).toBeVisible();

  await pagina.getByLabel(/Nota/).selectOption("4");
  await pagina.getByRole("button", { name: "Aprovar PR" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar PR" })).toHaveCount(0);
  await expect(pagina.locator("#I-215\\.R1")).toContainText("nota 4");
});

test("CA-22 e CA-23: reprovar o PR pede o motivo e, com ele, abre a sessão de ajustes", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearPrDaRodada(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-215`);
  await pagina.getByRole("button", { name: "Reprovar PR" }).click();
  await expect(pagina.locator("#motivo-I-215\\.R1-erro")).toHaveText("O motivo é obrigatório para recusar.");
  await expect(pagina.getByRole("button", { name: "Reprovar PR" })).toBeVisible();

  await pagina.getByLabel(/Motivo/).fill("falta teste");
  await pagina.getByRole("button", { name: "Reprovar PR" }).click();
  const link = pagina.getByRole("link", { name: /Sessão de ajustes de I-215\.R1/ });
  await expect(link).toBeVisible();
  const [aba] = await Promise.all([pagina.context().waitForEvent("page"), link.click()]);
  await aba.waitForLoadState();
  await expect(aba.locator("body")).not.toContainText("Página não encontrada");
  await expect(aba.locator("body")).toContainText("conversa");
  await expect(pagina.getByRole("button", { name: "Reprovar PR" })).toHaveCount(0);
});

test("CA-24 e CA-25: reabrir o ticket em falha pede a instrução e, com ela, tira o ticket da falha", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-207`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await expect(pagina.locator(".dm-gate-titulo", { hasText: "Reabrir I-207.T1" })).toBeVisible();
  await info.attach("reabrir-1440", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });
  await pagina.setViewportSize({ width: 375, height: 900 });
  await expect(pagina.getByRole("button", { name: "Reabrir" })).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("reabrir-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

  await pagina.getByRole("button", { name: "Reabrir" }).click();
  await expect(pagina.locator("[id='instrucao-I-207.T1-erro']")).toHaveText("A instrução é obrigatória para reabrir.");
  await expect(pagina.getByText("Falhou", { exact: true })).toBeVisible();

  await pagina.getByLabel(/Instrução/).fill("refazer o teste do caminho de erro");
  await pagina.getByRole("button", { name: "Reabrir" }).click();
  await expect(pagina.getByRole("button", { name: "Reabrir" })).toHaveCount(0);
  await expect(pagina.getByText("Falhou", { exact: true })).toHaveCount(0);
  await expect(pagina.getByText("refazer o teste do caminho de erro")).toBeVisible();
});

// Um pi que não termina, para o ticket seguir em execução enquanto o teste confere a página e o quadro.
const piParado = join(mkdtempSync(join(tmpdir(), "pi-parado-")), "pi");
writeFileSync(piParado, '#!/bin/sh\n[ "$1" = "--version" ] && echo 0.0.0-falso && exit 0\nexec sleep 60\n', {
  mode: 0o755,
});

test.describe("CA-26", () => {
  test.use({ pi: piParado });
  test("CA-26: Executar agora põe o ticket em execução na página e no trabalho ativo do quadro", async ({
    pagina,
    fabriquinha,
  }, info) => {
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await pagina.setViewportSize({ width: 375, height: 900 });
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toHaveCount(1);
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T2" }).getByRole("button")).toHaveCount(0);
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach("executar-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toHaveCount(0);
    // Pelo menu, sem recarregar: o quadro lê o trabalho ativo antes de o pi falso terminar.
    await pagina.getByRole("link", { name: "Demandas", exact: true }).first().click();
    await expect(pagina.locator(".dm-trabalho")).toContainText("I-216.T1");
  });

  test("Executar agora na página desatualizada mostra a orientação do servidor e recarrega o status atual", async ({
    pagina,
    fabriquinha,
  }) => {
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toBeVisible();
    // Outro caminho inicia o T1 com a página aberta.
    await pagina.evaluate(() => fetch("/api/demandas/tickets/I-216.T1/executar", { method: "POST" }));
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator("[data-aviso]")).not.toBeEmpty();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toHaveCount(0);
  });
});

test("CA-27 e CA-28: cancelar pede a confirmação com a dependente e, confirmado, o quadro mostra as duas canceladas", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearDemandas(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-206`);
  await pagina.setViewportSize({ width: 375, height: 900 });
  await pagina.getByRole("button", { name: "Cancelar a demanda" }).click();
  const confirmacao = pagina.locator("[data-confirmar-cancelar]");
  await expect(confirmacao).toContainText("I-207");
  await expect(pagina.getByRole("button", { name: "Confirmar o cancelamento" })).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("cancelar-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

  // Voltar não cancela nada.
  await pagina.getByRole("button", { name: "Voltar" }).click();
  await expect(confirmacao).toBeHidden();
  await pagina.getByRole("button", { name: "Cancelar a demanda" }).click();

  await pagina.getByRole("button", { name: "Confirmar o cancelamento" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas`);
  await expect(cartao(pagina, "I-206")).toContainText("Cancelada");
  await expect(cartao(pagina, "I-207")).toContainText("Cancelada");
});

test("CA-29: arquivar a demanda concluída a tira do quadro", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandaConcluida(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas`);
  await expect(cartao(pagina, "I-217")).toBeVisible();
  await pagina.goto(`${fabriquinha.base}/demandas/I-217`);
  await expect(pagina.getByRole("button", { name: "Cancelar a demanda" })).toHaveCount(0);
  await pagina.getByRole("button", { name: "Arquivar" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/demandas`);
  await expect(cartao(pagina, "I-217")).toHaveCount(0);
});
