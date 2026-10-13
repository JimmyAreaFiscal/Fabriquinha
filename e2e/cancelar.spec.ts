// Cancelar a issue pela página dela (F7 §4.4; C22): a confirmação, o estado Cancelada, os tickets fechados, a dependente
// que vai junto, a execução viva parada pelo pi falso e a issue concluída que não se cancela.
import { expect, projeto, test } from "./apoio.ts";

const AGORA = "2026-10-11T12:00:00.000Z";

test("cancela a issue no desenho: ticket fechado, dependente cancelada e nada apagado", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES
       (1, 'loja', 'Registrada por engano', 'funcionalidade', 'desenho', '${AGORA}'),
       (2, 'loja', 'Depende da engano', 'funcionalidade', 'registro', '${AGORA}');
     INSERT INTO issue_dep (issue, dep) VALUES (2, 1);
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES
       (1, 1, 'desenho', 'Desenhar a solução', 'aberto', 'fabriquinha', '${AGORA}'),
       (2, 2, 'registro', 'Registrar a necessidade', 'aberto', 'fabriquinha', '${AGORA}');`,
  );
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "Cancelar issue" }).click();

  const dialogo = pagina.locator("[data-dialogo-cancelar]");
  await expect(dialogo).toContainText("A issue sai do andamento e não volta mais. Nada é apagado");
  await expect(dialogo.locator(".efeitos")).toContainText("Ticket que será fechado: T-1");
  await expect(dialogo.locator(".efeitos").getByRole("link", { name: "I-2" })).toHaveAttribute(
    "href",
    "/projects/loja/issues/I-2",
  );
  await expect(dialogo.locator(".efeitos")).toContainText("loja · registro");
  await dialogo.getByRole("button", { name: "Voltar" }).click();
  await expect(dialogo).toBeHidden();
  await expect(pagina.locator(".titulo-issue .pill-cancelada")).toHaveCount(0);

  await pagina.getByRole("button", { name: "Cancelar issue" }).click();
  await dialogo.locator("[data-confirmar-cancelar]").click();
  await expect(pagina.locator(".titulo-issue .pill-cancelada")).toHaveText("Cancelada");
  await expect(pagina.locator(".trilho-fases")).toHaveClass(/cancelada/);
  await expect(pagina.getByRole("button", { name: "Cancelar issue" })).toHaveCount(0);
  await expect(pagina.locator(".fatos")).toContainText("Cancelada");
  await expect(pagina.locator(".linha-tempo li")).toHaveCount(1);
  await expect(pagina.locator(".linha-tempo .pill")).toHaveText("fechado");
  await expect(pagina.getByRole("button", { name: "+ adicionar" })).toHaveCount(0);

  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-2`);
  await expect(pagina.locator(".titulo-issue .pill-cancelada")).toHaveText("Cancelada");
  await expect(pagina.locator(".linha-tempo .pill")).toHaveText("fechado");
});

test("cancela com a execução viva: o ticket fica cancelado e a sessão termina", async ({ pagina, fabriquinha }) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
       VALUES (1, 'loja', 'Timeout no checkout com cupom', 'problema', '[ao vivo]', 'desenvolvimento', '${AGORA}');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
       VALUES (1, 1, 'desenvolvimento', 'Buscar cupons sem N+1', 'aberto', 'fabriquinha', '${AGORA}');`,
  );
  const executar = await pagina.request.post(`${fabriquinha.base}/api/tickets/1/executar`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(executar.status()).toBe(204);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(pagina.locator(".linha-tempo .pill").first()).toHaveText("em execução");

  await pagina.getByRole("button", { name: "Cancelar issue" }).click();
  await expect(pagina.locator("[data-dialogo-cancelar] .efeitos")).toContainText(
    "A execução em andamento de T-1 será parada",
  );
  await pagina.locator("[data-confirmar-cancelar]").click();
  await expect(pagina.locator(".titulo-issue .pill-cancelada")).toHaveText("Cancelada");
  await expect(pagina.locator(".linha-tempo .pill").first()).toHaveText("cancelado");

  const ativas = await pagina.request.get(`${fabriquinha.base}/api/sessoes?escopo=ativas`);
  expect(await ativas.json()).toEqual([]);
  const log = async () => (await (await pagina.request.get(`${fabriquinha.base}/api/execucoes/1/log`)).text()).length;
  const tamanho = await log();
  await pagina.waitForTimeout(700);
  expect(await log()).toBe(tamanho);
});

test("issue concluída: botão desabilitado e o motivo", async ({ pagina, fabriquinha }) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em)
       VALUES (1, 'loja', 'Já entregue', 'funcionalidade', 'concluida', '${AGORA}', '${AGORA}');`,
  );
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(pagina.getByRole("button", { name: "Cancelar issue" })).toBeDisabled();
  await expect(pagina.locator(".cancelar")).toContainText("A I-1 está concluída e não pode ser cancelada.");
  await expect(pagina.locator(".titulo-issue .pill-cancelada")).toHaveCount(0);
});

test("no projeto a cancelada sai do andamento e volta apagada; os cards de custo e tokens do mês não mudam", async ({
  pagina,
  fabriquinha,
}) => {
  const agora = new Date(2026, 9, 15, 12, 0);
  const instante = agora.toISOString();
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES
       (1, 'loja', 'Registrada por engano', 'funcionalidade', 'desenho', '${instante}'),
       (2, 'loja', 'Segue no processo', 'funcionalidade', 'desenho', '${instante}');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES
       (1, 1, 'desenho', 'Desenhar a solução', 'aberto', 'fabriquinha', '${instante}'),
       (2, 2, 'desenho', 'Desenhar a outra', 'aberto', 'fabriquinha', '${instante}');
     INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
       VALUES (1, 1, 'autonomo', '${crypto.randomUUID()}', 'sucesso', '${instante}', '${instante}');
     INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
       VALUES (1, 'anthropic', 'claude-sonnet-5-5', 10, 4000, 500, 0, 0, 4);`,
  );
  await pagina.clock.setFixedTime(agora);
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  const cards = pagina.locator(".kpis-mes .kpi");
  await expect(cards.nth(0)).toContainText("US$ 4,00");
  const antes = await cards.allTextContents();
  await expect(pagina.locator(".contagem")).toContainText("2 em andamento");
  await expect(pagina.locator("[data-issue]")).toHaveCount(2);

  const cancelar = await pagina.request.post(`${fabriquinha.base}/api/issues/1/cancelar`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(cancelar.status()).toBe(204);
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.locator(".contagem")).toContainText("1 em andamento");
  await expect(pagina.locator(".contagem")).toContainText("1 cancelada");
  await expect(pagina.locator("[data-issue]")).toHaveCount(1);
  await expect(pagina.locator('[data-issue="1"]')).toHaveCount(0);

  await pagina.getByLabel("Mostrar canceladas").check();
  const apagada = pagina.locator('[data-issue="1"]');
  await expect(apagada).toHaveClass(/apagada/);
  await expect(apagada.locator("span.cancelada")).toContainText(/cancelada em \d\d\/\d\d/);
  await expect(apagada.locator(".trilho-fases")).toHaveClass(/cancelada/);
  expect(await cards.allTextContents()).toEqual(antes);
});
