// Início (F7 §4.4, itens 3 e 4): a linha de Rodando diz o que o agente está fazendo agora, pelo processo vivo, e o
// card do gate do PR traz o número do PR.
import { abrir } from "../src/persistencia/banco.ts";
import type { Locator } from "@playwright/test";
import { expect, projeto, test } from "./apoio.ts";

test("Rodando mostra o que o agente está fazendo agora, e não só o título do ticket", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
       VALUES (1, 'loja', 'Timeout no checkout com cupom', 'problema', '[ao vivo]', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
       VALUES (1, 1, 'desenvolvimento', 'Buscar cupons sem N+1', 'aberto', 'fabriquinha', '2026-10-11T12:00:00.000Z');
     UPDATE projeto SET modelos = '{"desenvolvimento":{"provedor":"anthropic","modelo":"claude-sonnet-5-5"}}';`,
  );
  const executar = await pagina.request.post(`${fabriquinha.base}/api/tickets/1/executar`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(executar.status()).toBe(204);
  await pagina.goto(`${fabriquinha.base}/home`);
  // O pi falso roda `npm test` e fica escrevendo; o Início relê a cada 5 s, então recarregar mostra o agora.
  await expect(async () => {
    await pagina.reload();
    await expect(pagina.locator(".rodando-linha")).toContainText("Timeout no checkout com cupom — bash npm test", {
      timeout: 500,
    });
  }).toPass();
  // O nome do modelo fica numa linha só, sem quebrar no hífen, com o nome inteiro no `title`.
  const modelo = pagina.locator(".rodando-linha").getByText("anthropic / claude-sonnet-5-5");
  expect(await linhasDo(modelo, /.+/)).toBe(1);
  await expect(modelo).toHaveAttribute("title", "anthropic / claude-sonnet-5-5");
  // O tempo também ("há menos de 1 min"): na linha de Rodando, e na marca do cartão, onde só quebra antes da duração.
  expect(await linhasDo(pagina.locator(".rodando-linha .tempo"), /.+/)).toBe(1);
  expect(await linhasDo(pagina.locator(".cartao-marcas .pill"), /[^·\s][^·]*$/)).toBe(1);
  // Com 1 min, "em execução · 1" cabia na primeira linha do cartão e o "min" ia sozinho para a segunda.
  await pagina.clock.setFixedTime(Date.now() + 90_000);
  await pagina.reload();
  await expect(pagina.locator(".cartao-marcas .pill")).toHaveText("em execução · 1 min");
  expect(await linhasDo(pagina.locator(".cartao-marcas .pill"), /1\smin$/)).toBe(1);
});

/** Em quantas linhas da página o trecho do texto do elemento ficou. */
const linhasDo = (elemento: Locator, trecho: RegExp) =>
  elemento.evaluate((e, trecho) => {
    const texto = e.firstChild;
    const achado = new RegExp(trecho).exec(texto?.textContent ?? "");
    if (!texto || !achado) throw new Error(`sem "${trecho}" em "${e.textContent}"`);
    const r = document.createRange();
    r.setStart(texto, achado.index);
    r.setEnd(texto, achado.index + achado[0].length);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  }, trecho.source);

test("o card do gate do PR traz o número do PR aberto", async ({ pagina, fabriquinha }) => {
  const banco = abrir(fabriquinha.raiz);
  const pr = JSON.stringify({
    hospedagem: "github",
    id: "212",
    url: "https://github.com/x/loja/pull/212",
    branch: "b",
    base: "main",
  });
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
      VALUES (1, 'loja', 'Webhook do Pix', 'problema', '', 'aprovacao_pr', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (1, 1, 'encerramento', 'Publicar o PR', 'concluido', 'fabriquinha', '2026-10-11T12:00:00.000Z', '2026-10-11T12:30:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6', 'sucesso', '2026-10-11T12:00:00.000Z', '2026-10-11T12:30:00.000Z');
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em)
      VALUES (1, 1, 'pr_aberto', 'fabriquinha', '${pr}', '2026-10-11T12:30:00.000Z');
  `);
  banco.close();
  await pagina.goto(`${fabriquinha.base}/home`);
  await expect(pagina.locator(".decisao")).toContainText("PR #212 aberto; aguarda a sua revisão no PR");
});
