// Demandas (T-1289): o quadro do projeto e a página da demanda, com os gates, os tickets, a sessão de ajustes, o
// cancelamento e o arquivamento; prints a 1440 e 375 px (o último sem rolagem horizontal). O board do Início, que tomou
// o lugar da lista das demandas, fica em inicio.spec.ts.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projeto } from "./apoio.ts";
import {
  semearDemandaConcluida,
  semearDemandas,
  semearGateDaDemanda,
  semearPaginaDaDemanda,
  semearPlanejamento,
  semearPrDaRodada,
  registrarCorrecaoDaSessao,
  semearTicketAberto,
} from "./demandas-apoio.ts";
import { expect, test } from "./apoio.ts";

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

  // Só os dois do gate do PR (R1), os dois da sessão de ajustes (R2: Enviar e Concluir), o Reabrir do T5 falho e os três do cancelamento; a tela da issue não usa `.dm-` (CA-33).
  await expect(pagina.locator("main button")).toHaveCount(8);

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

test("CA-31: a demanda que não existe mostra o aviso e o link ao Início", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-999`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("Demanda não encontrada");
  await pagina.getByRole("link", { name: "Ir para o Início" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
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

test("o gate da demanda mostra a descrição, os critérios e o desenho, que abre na caixa", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearGateDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-214`);
  const gate = pagina.locator(".dm-gate", { hasText: "Aprovação da demanda" });
  await expect(gate.locator(".fatos")).toContainText("funcionalidade");
  await expect(gate.locator(".fatos strong", { hasText: "perde" })).toBeVisible();
  await expect(gate.locator(".fatos")).toContainText("Hoje o cupom some no F5.");
  const criterio = gate.getByRole("row", { name: /CA-1/ });
  await expect(criterio).toContainText("um cupom aplicado");
  await expect(criterio).toContainText("o cliente recarrega");
  await expect(criterio).toContainText("o cupom continua");
  await expect(gate.locator(".numero", { hasText: "arquivo previsto" })).toContainText("1");
  await expect(gate.locator(".numero", { hasText: "acoplamento novo" })).toContainText("1");
  await expect(gate.locator(".numero .impacto-medio")).toHaveText("médio");
  await expect(gate).toContainText("Guardar o cupom na sessao");
  await expect(gate.getByRole("row", { name: /src\/carrinho\.ts/ })).toContainText("ler o cupom da sessão");
  await expect(gate).toContainText("cupons expirados");

  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach(`gate-conteudo-${String(largura)}`, {
      body: await pagina.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await gate.getByRole("button", { name: /Desenho da solução/ }).click();
  const caixa = pagina.locator("dialog[open]");
  await expect(caixa.locator("[data-caixa-titulo]")).toHaveText("Desenho da solução");
  await expect(caixa.frameLocator("iframe").getByRole("heading", { name: "Desenho do cupom" })).toBeVisible();
  await info.attach("gate-desenho-caixa", { body: await pagina.screenshot(), contentType: "image/png" });
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
  expect(await pagina.locator(".dm-rodada .dm-tickets ~ .dm-gate").count()).toBe(2);
  await expect(pagina.locator(".dm-gate-titulo", { hasText: "Aprovação do PR" })).toBeVisible();
  await info.attach("gate-pr-1440", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });
  await pagina.setViewportSize({ width: 375, height: 900 });
  await expect(pagina.getByRole("button", { name: "Aprovar PR" })).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Reprovar PR" })).toBeVisible();
  // CA-11: o formulário da reprovação tem o motivo e nenhum seletor de nota.
  const reprovacao = pagina.locator(".dm-gate", { has: pagina.getByRole("button", { name: "Reprovar PR" }) });
  await expect(reprovacao.getByLabel(/Motivo/)).toBeVisible();
  await expect(reprovacao.locator("select")).toHaveCount(0);
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
  await expect(pagina.getByRole("link", { name: "Sessão de ajustes ↓" })).toHaveAttribute("href", "#ajustes-I-215.R1");
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
  test("CA-26: Executar agora põe o ticket em execução na página e no Rodando do Início", async ({
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
    // Pelo menu, sem recarregar: o Início mostra a sessão do pi parado rodando.
    await pagina
      .getByRole("navigation", { name: "Páginas" })
      .getByRole("link", { name: /^Início/ })
      .click();
    await expect(pagina.locator(".rodando-linha")).toContainText("I-216.T1");
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

test.describe("CA-14: concluir a sessão de ajustes", () => {
  test("sem correção mostra a orientação e a sessão continua; com a correção, a rodada sai da sessão", async ({
    pagina,
    fabriquinha,
  }, info) => {
    projeto(fabriquinha.raiz);
    semearPrDaRodada(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-215`);
    await pagina.getByLabel(/Motivo/).fill("falta teste");
    await pagina.getByRole("button", { name: "Reprovar PR" }).click();
    const secao = pagina.locator("#ajustes-I-215\\.R1");
    // A primeira resposta do agente (ao prompt de abertura) chega sem recarregar: a conversa ainda não existia.
    await expect(secao.locator(".dm-msg-agente")).toContainText("pronto");
    await secao.getByLabel("Mensagem ao agente").fill("eco: ajustei o teste de login");
    await secao.getByRole("button", { name: "Enviar" }).click();
    await expect(secao.locator(".dm-msg-auditor")).toContainText("eco: ajustei o teste de login");
    await expect(secao.locator(".dm-msg-agente").last()).toContainText("ajustei o teste de login");

    await secao.getByRole("button", { name: "Concluir a sessão" }).click();
    await expect(pagina.locator("[data-aviso]")).not.toBeEmpty();
    await expect(pagina.locator("#I-215\\.R1")).toContainText("Sessão de ajustes");

    registrarCorrecaoDaSessao(fabriquinha.raiz, "I-215", 1);
    await secao.getByRole("button", { name: "Concluir a sessão" }).click();
    await expect(pagina.locator("#I-215\\.R1")).not.toContainText("Sessão de ajustes");
    for (const largura of [1440, 375]) {
      await pagina.setViewportSize({ width: largura, height: 900 });
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await info.attach(`concluir-${String(largura)}`, {
        body: await pagina.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  });
});

test("CA-27 e CA-28: cancelar pede a confirmação com a dependente e, confirmado, as duas saem do Início", async ({
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
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  await expect(pagina.getByText("1 demanda em andamento")).toBeVisible();
  await expect(pagina.locator('.board-etapas .id:text-matches("^I-20[67]")')).toHaveCount(0);
});

test("CA-29: arquivar a demanda concluída a tira das demandas e leva ao Início", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearDemandaConcluida(fabriquinha.raiz);
  const demandas = async () =>
    (
      (await (await pagina.request.get(`${fabriquinha.base}/api/demandas`)).json()) as { demandas: { id: string }[] }
    ).demandas.map((d) => d.id);
  expect(await demandas()).toEqual(["I-217"]);
  await pagina.goto(`${fabriquinha.base}/demandas/I-217`);
  await expect(pagina.getByRole("button", { name: "Cancelar a demanda" })).toHaveCount(0);
  await pagina.getByRole("button", { name: "Arquivar" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  expect(await demandas()).toEqual([]);
});
