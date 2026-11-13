// Demandas (T-1289): o quadro do projeto e a página da demanda, com os gates, os tickets, a sessão de ajustes, o
// cancelamento e o arquivamento; prints a 1440 e 375 px (o último sem rolagem horizontal). O board do Início, que tomou
// o lugar da lista das demandas, fica em inicio.spec.ts.
import type { PassoPi } from "../apoio-testes/pi_falso.ts";
import { abrirBancoDaFabriquinha } from "../src/server/composicao/banco_da_fabriquinha.ts";
import { execucoesAbertas } from "../src/modulos/sessoes/publico.ts";
import { projeto, expect, test } from "./apoio.ts";
import { PENDENCIAS_ESPERADAS, semearPendencias } from "./pendencias-apoio.ts";
import {
  semearDemandaAguardandoMerge,
  semearDemandaConcluida,
  semearDependenciaEntreDemandas,
  semearDemandas,
  semearGateDaDemanda,
  semearPaginaDaDemanda,
  semearPlanejamento,
  semearPlanejamentoComPi,
  semearPrDaRodada,
  registrarCorrecaoDaSessao,
  semearTicketAberto,
} from "./demandas-apoio.ts";

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
  await expect(r1.getByRole("link", { name: "PR #7 ↗", exact: true })).toHaveAttribute(
    "href",
    "https://exemplo.com/pr/7",
  );
  await expect(r1.locator("li", { hasText: "I-210.T1" })).toContainText("Concluído");
  // CA-11: a decisão com o motivo escrito, no ticket.
  await expect(r1.locator("li", { hasText: "I-210.T2" })).toContainText("falta teste do caminho de erro");
  const r2 = pagina.locator("#I-210\\.R2");
  await expect(r2).toContainText("Sessão de ajustes");
  await expect(r2.locator("li", { hasText: "I-210.T5" })).toContainText("Falhou");
  await expect(r2).toContainText("o teste de erro não passou");
  // O planejar global que veio depois das rodadas fecha a linha do tempo.
  await expect(pagina.getByRole("region", { name: "Depois das rodadas" })).toContainText("I-210.T6");
  await expect(pagina.getByRole("region", { name: "Depois das rodadas" })).not.toContainText("I-210.T1");
  await expect(pagina.locator("main")).not.toContainText(/\bT-\d+\b/);

  // CA-13: a dependência com o estado e o link.
  const dependencias = pagina.getByRole("region", { name: "Dependências" });
  await expect(dependencias).toContainText("Execução");
  await expect(dependencias.getByRole("link", { name: "I-211" })).toHaveAttribute("href", "/demandas/I-211");

  // CA-12: integração concluída, limpeza falhou, nada de "nada foi integrado".
  const encerramento = pagina.getByRole("region", { name: "Encerramento final" });
  await expect(encerramento).toContainText("Integração concluída");
  await expect(encerramento).toContainText("Limpeza falhou");
  await expect(encerramento).not.toContainText(/nada foi integrado/i);

  // Fora os chips das evidências e o "ler tudo", só os dois do gate do PR (R1), o Concluir da sessão de ajustes (R2; a
  // conversa é no chat), o Reabrir do T5 falho e os três do cancelamento; a tela da demanda não usa `.dm-` (CA-33).
  await expect(pagina.locator("main button:not(.dm-chip, [data-expandir])")).toHaveCount(7);

  // Aguarda você leva ao ticket falho na mesma página, sem redesenhá-la.
  await pagina.setViewportSize({ width: 1440, height: 400 });
  const falho = pagina.locator("#I-210\\.T5");
  await falho.evaluate((no) => {
    no.dataset.marca = "antes do clique";
  });
  await pagina
    .getByRole("region", { name: "Aguarda você" })
    .getByRole("link", { name: /Reabrir o ticket I-210\.T5/ })
    .click();
  await expect(falho).toBeInViewport();
  await expect(falho).toHaveAttribute("data-marca", "antes do clique");

  // O chip da evidência abre os dados dela na caixa, também do gate do PR, onde o Auditor decide.
  await pagina.locator("#pr-I-210\\.R1").getByRole("button", { name: "PR aberto" }).click();
  await expect(pagina.locator("dialog[open] [data-caixa-titulo]")).toHaveText("PR aberto · I-210.T3");
  await expect(pagina.locator("dialog[open] .dm-dados")).toContainText("https://exemplo.com/pr/7");
  await pagina.keyboard.press("Escape");

  // CA-10: clicar no print, junto do ticket que o gerou, abre a imagem na caixa.
  await pagina.locator("li", { hasText: "I-210.T3" }).getByRole("link", { name: "print.png" }).click();
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

const estado = (pagina: import("@playwright/test").Page) => pagina.locator(".dm-cabeca .pill");

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
  await expect(pagina.getByRole("button", { name: "Reprovar" })).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("gate-375", { body: await pagina.screenshot({ fullPage: true }), contentType: "image/png" });

  // CA-15: motivo vazio, a mensagem junto ao campo e o estado não muda.
  await pagina.getByRole("button", { name: "Reprovar" }).click();
  await expect(pagina.locator("#motivo-decisao-erro")).toHaveText("O motivo é obrigatório para reprovar.");
  await expect(estado(pagina)).toHaveText("Aprovação da demanda");

  // CA-16: com o motivo, o estado devolvido e os botões somem.
  await pagina.getByLabel(/Motivo/).fill("escopo incompleto");
  await pagina.getByRole("button", { name: "Reprovar" }).click();
  await expect(pagina.getByRole("button", { name: "Reprovar" })).toHaveCount(0);
  await expect(estado(pagina)).not.toHaveText("Aprovação da demanda");
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
  await expect(pagina.locator("#motivo-planejamento-decisao-erro")).toHaveText("O motivo é obrigatório para reprovar.");
  await expect(estado(pagina)).toHaveText("Aprovação do planejamento");
  await pagina.getByLabel(/Motivo/).fill("falta o caso de erro");
  await pagina.getByRole("button", { name: "Reprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Reprovar planejamento" })).toHaveCount(0);
  await expect(estado(pagina)).not.toHaveText("Aprovação do planejamento");

  await pagina.goto(`${fabriquinha.base}/demandas/I-213`);
  await pagina.getByRole("button", { name: "Aprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar planejamento" })).toHaveCount(0);
  await expect(estado(pagina)).not.toHaveText("Aprovação do planejamento");
});

test("CA-30: a página desatualizada mostra a orientação do servidor e o estado atual", async ({
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
      body: JSON.stringify({ resultado: "aprovado" }),
    }),
  );
  await pagina.getByRole("button", { name: "Aprovar" }).click();
  await expect(pagina.locator("[data-aviso]")).not.toBeEmpty();
  await expect(pagina.locator("[data-aviso]")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await expect(estado(pagina)).not.toHaveText("Aprovação da demanda");
});

test("CA-14: Aprovar a demanda mostra o estado devolvido e os botões somem", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearGateDaDemanda(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/demandas/I-214`);
  await pagina.getByRole("button", { name: "Aprovar" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await expect(estado(pagina)).not.toHaveText("Aprovação da demanda");
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
  await expect(pagina.locator(".dm-rodada .dm-tickets ~ .dm-gate")).toHaveCount(2);
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
  await expect(pagina.locator("#motivo-I-215\\.R1-erro")).toHaveText("O motivo é obrigatório para reprovar.");
  await expect(pagina.getByRole("button", { name: "Reprovar PR" })).toBeVisible();

  await pagina.getByLabel(/Motivo/).fill("falta teste");
  await pagina.getByRole("button", { name: "Reprovar PR" }).click();
  await expect(pagina.locator("#ajustes-I-215\\.R1").getByRole("link", { name: "Abrir a sessão →" })).toHaveAttribute(
    "href",
    /^\/sessions\//,
  );
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
const roteiroDoPiParado: PassoPi[] = [{ termina: "trava" }];

test.describe("CA-26", () => {
  test.use({ roteiroDoPi: roteiroDoPiParado });
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
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );
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
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toHaveCount(0);
  });
});

test.describe("I-281 CA-3", () => {
  test.use({ roteiroDoPi: roteiroDoPiParado });
  test("Executar agora com o limite de paralelismo ocupado mostra o motivo da recusa e não cria execução", async ({
    pagina,
    fabriquinha,
  }) => {
    projeto(fabriquinha.raiz, "UPDATE configuracao SET limite_paralelismo = 1");
    semearTicketAberto(fabriquinha.raiz);
    semearPlanejamentoComPi(fabriquinha.raiz, "Exportar pedidos em CSV");
    // O planejamento da I-230 ocupa a única vaga; o pi parado a mantém ocupada.
    await pagina.goto(`${fabriquinha.base}/demandas/I-230`);
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-230.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );

    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    const [resposta] = await Promise.all([
      pagina.waitForResponse((r) => r.url().endsWith("/api/demandas/tickets/I-216.T1/executar")),
      pagina.getByRole("button", { name: "Executar agora" }).click(),
    ]);
    expect(await resposta.json()).toEqual({ tipo: "limite_de_paralelismo", em_uso: 1, limite: 1 });
    await expect(pagina.locator("[data-aviso]")).toHaveText("Limite de paralelismo cheio: 1 de 1 em uso");
    await expect(pagina.getByRole("button", { name: "Executar agora" })).toHaveCount(1);
    const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
    expect(execucoesAbertas(banco).map(({ demanda_id, ticket_id }) => `${demanda_id}.T${String(ticket_id)}`)).toEqual([
      "I-230.T1",
    ]);
    banco.close();
  });
});

test.describe("CA-14: conversar e concluir a sessão de ajustes", () => {
  test("a pergunta do agente chega ao Auditor no chat da sessão; sem correção a sessão continua; com ela, a rodada sai da sessão", async ({
    pagina,
    fabriquinha,
  }, info) => {
    projeto(fabriquinha.raiz);
    semearPrDaRodada(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-215`);
    // O motivo vai ao prompt de abertura; com ele, o pi falso pergunta pela `perguntar`, como o agente da I-260.T39.
    await pagina.getByLabel(/Motivo/).fill("pergunte perguntar");
    await pagina.getByRole("button", { name: "Reprovar PR" }).click();
    const secao = pagina.locator("#ajustes-I-215\\.R1");
    await expect(
      pagina.locator(".dm-ticket", { hasText: "Sessão em aberto" }).getByRole("link", { name: "chat →" }),
    ).toBeVisible();

    await secao.getByRole("link", { name: "Abrir a sessão →" }).click();
    const dialogo = pagina.locator("form.dialogo-ext");
    await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
    const chat = pagina.url();

    // O Início também aponta a pergunta do agente da sessão de ajustes, e leva ao chat.
    await pagina.goto(`${fabriquinha.base}/home`);
    await expect(pagina.locator("main")).toContainText("O agente pergunta: Qual ordem os cupons devem ter?");
    await pagina.goto(chat);
    await dialogo.getByRole("button", { name: "Validade mais próxima" }).click();
    const conversa = pagina.locator("[data-conversa]");
    await expect(conversa.locator(".msg.agente").last()).toHaveText(
      'Resposta do diálogo: {"value":"Validade mais próxima"}',
    );
    await expect(pagina.locator(".estado-sessao .pill")).toHaveText("aguarda você · conversa");
    await pagina.getByRole("textbox", { name: "Mensagem" }).fill("eco: ajustei o teste de login");
    await pagina.getByRole("button", { name: "Enviar" }).click();
    await expect(conversa.locator(".msg.agente").last()).toHaveText("ajustei o teste de login");

    await pagina.goto(`${fabriquinha.base}/demandas/I-215`);
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

test("a integração final espera o merge humano: o passo leva ao PR e o quadro avisa", async ({
  pagina,
  fabriquinha,
}, info) => {
  projeto(fabriquinha.raiz);
  semearDemandaAguardandoMerge(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/demandas`);
  await expect(pagina.locator(".dm-cartao.aguarda")).toContainText("aguarda você · ação externa · I-218");

  await pagina.goto(`${fabriquinha.base}/demandas/I-218`);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  const integracao = pagina
    .getByRole("region", { name: "Encerramento final" })
    .locator("li", { hasText: "Integração" });
  await expect(integracao).toContainText("Aguardando você");
  await expect(integracao.getByRole("link", { name: /aprove e integre o PR final na plataforma/ })).toHaveAttribute(
    "href",
    "https://exemplo.com/pr/12",
  );
  const aguarda = pagina.getByRole("region", { name: "Aguarda você" });
  await expect(
    aguarda.getByRole("link", { name: /Integrar o PR I-218: Integrar o PR final #12 na plataforma/ }),
  ).toHaveAttribute("href", "#titulo-encerramento");
  await expect(aguarda).not.toContainText("Executar");
  await info.attach("merge-humano-1440", {
    body: await pagina.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await pagina.setViewportSize({ width: 375, height: 900 });
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("merge-humano-375", {
    body: await pagina.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("o quadro mostra as seis Pendências, a rodada em ajustes e a dependência como estado do item", async ({
  pagina,
  fabriquinha,
}) => {
  semearPendencias(fabriquinha.raiz);
  semearDependenciaEntreDemandas(fabriquinha.raiz, "I-302", "I-301");
  await pagina.goto(`${fabriquinha.base}/projects/loja/demandas`);
  const marcas = {
    gate_humano: "gate",
    item_bloqueado: "bloqueado",
    dialogo_do_agente: "diálogo",
    revisao_parada: "revisão parada",
    acao_externa: "ação externa",
    despacho_parado: "despacho parado",
  };
  const pendencias = pagina.locator(".dm-cartao .pill", { hasText: "aguarda você" });
  await expect(pendencias).toHaveCount(PENDENCIAS_ESPERADAS.length);
  for (const { item, tipo } of PENDENCIAS_ESPERADAS) {
    await expect(pendencias.filter({ hasText: `aguarda você · ${marcas[tipo]} · ${item}` })).toHaveCount(1);
  }
  await expect(pagina.locator(".dm-cartao", { hasText: "I-303" }).locator(".dm-rodadas")).toContainText(
    "Sessão de ajustes",
  );
  // Esperar Dependência não é Pendência: aparece à parte, como estado do cartão.
  const bloqueada = pagina.locator(".dm-cartao", { hasText: "Demanda I-302" });
  await expect(bloqueada).toContainText("bloqueada por I-301");
  await expect(pagina.locator(".dm-cartao .pill", { hasText: "bloqueada por" })).toHaveCount(1);
});
