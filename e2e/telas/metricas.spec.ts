// Métricas (F7 §4.4, §7), lidas das tabelas da demanda: mudar o mês em foco faz a média usar só os meses anteriores a ele; o gráfico mostra a dica
// e troca o foco no clique; o Início mostra a frase do mês e o Projeto, os 5 cards do mês.
import { abrirBancoDaFabriquinha } from "../../src/server/system/banco_da_fabriquinha.ts";
import { expect, SECOES_DE_ETAPA, test } from "../apoio.ts";

/** O agora do navegador, fixo em outubro de 2026: o mês corrente é M0, e o período padrão vai de nov/25 a out/26. */
const AGORA = new Date(2026, 9, 15, 12, 0);
const [M2, M1, M0] = ["2026-08", "2026-09", "2026-10"];

/** O dia 1º do mês ao meio-dia, no fuso local (o do serviço), como o banco grava: em UTC. */
const em = (mes: string) => new Date(`${mes}-01T12:00:00`).toISOString();

/** loja: I-1 (problema) com execuções de US$ 10, 20 e 60 nos três últimos meses; site: I-2 (funcionalidade) com US$ 5 no mês corrente. */
function semear(raiz: string): void {
  const banco = abrirBancoDaFabriquinha(raiz);
  const projeto = (nome: string) =>
    `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '${nome}');`;
  const demanda = (id: string, nome: string, titulo: string, tipo: string, mes: string) =>
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('${id}', '${nome}', '${titulo}', '${tipo}', 'd', 'em_execucao', '${em(mes)}', 'f', 's', 1, 'fabriquinha/${id}');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', '${em(mes)}');`;
  const execucao = (id: number, demandaId: string, mes: string, custo: number) =>
    `INSERT INTO trabalho_agentico VALUES ('s${String(id)}', '${demandaId}', 1, 'autonomo', 'conv${String(id)}');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('x${String(id)}', 's${String(id)}', '${em(mes)}', '${em(mes)}', 0);
    INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo) VALUES ('x${String(id)}', 'anthropic', 'claude-sonnet-5-5', ${String(custo * 1000)}, 500, 0, 0, ${String(custo)});`;
  banco.exec(`
    ${projeto("loja")}
    ${projeto("site")}
    ${demanda("I-1", "loja", "Busca por SKU", "problema", M2)}
    ${demanda("I-2", "site", "Página de contato", "funcionalidade", M0)}
    ${execucao(1, "I-1", M2, 10)}
    ${execucao(2, "I-1", M1, 20)}
    ${execucao(3, "I-1", M0, 60)}
    ${execucao(4, "I-2", M0, 5)}
  `);
  banco.close();
}

test("mudar o mês em foco: a média passa a usar só os meses anteriores a ele", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.reload();
  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Métricas" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/metrics`);

  const resumo = pagina.locator(".resumo");
  const custo = pagina.locator('[data-metrica="custo"]');
  // Padrão: os 11 meses anteriores mais o corrente; a média divide por 11, com os meses vazios.
  await expect(resumo).toHaveText("comparando out/26 com a média de 11 meses (nov/25 a set/26)");
  await expect(custo).toContainText("US$ 65,00");
  await expect(custo).toContainText("média US$ 2,73");

  // Período dos três meses: a média é a dos dois anteriores ao corrente.
  await pagina.getByLabel("De", { exact: true }).selectOption(M2);
  await expect(resumo).toHaveText("comparando out/26 com a média de 2 meses (ago/26 a set/26)");
  await expect(custo).toHaveText(/US\$ 65,00\s*média US\$ 15,00\s*▲ 333%/);

  // Foco no mês anterior, pela régua: a média passa a ser só a do primeiro mês.
  await pagina.getByRole("group", { name: "Mês em foco" }).getByRole("button", { name: "set/26" }).click();
  await expect(resumo).toHaveText("comparando set/26 com a média de 1 mês (ago/26)");
  await expect(custo).toHaveText(/US\$ 20,00\s*média US\$ 10,00\s*▲ 100%/);
  await expect(pagina.getByRole("heading", { level: 2, name: "set/26", exact: true })).toBeVisible();

  // No gráfico: a dica do mês sob o ponteiro e o clique que leva o foco ao primeiro mês, que não tem média.
  const colunas = pagina.locator("svg.barras .hit");
  await expect(colunas).toHaveCount(3);
  await colunas.nth(1).hover();
  const dica = pagina.locator("[data-dica]");
  await expect(dica).toBeVisible();
  await expect(dica).toHaveText("set/26 · em focoUS$ 20,00custoUS$ 10,00média dos anteriores");
  await colunas.nth(0).click();
  await expect(resumo).toHaveText("ago/26 é o primeiro mês do período: sem média para comparar");
  await expect(custo).toHaveText(/US\$ 10,00\s*sem meses anteriores/);

  // Ver tabela troca o gráfico pela tabela, com os mesmos números.
  await pagina.getByRole("button", { name: "ver tabela" }).click();
  await expect(pagina.locator("[data-evolucao] tbody tr")).toHaveText([
    "ago/26 · em focoUS$ 10,00",
    "set/26US$ 20,00",
    "out/26US$ 65,00",
  ]);
  await pagina.getByRole("button", { name: "ver gráfico" }).click();
  await expect(colunas).toHaveCount(3);

  // Por demanda, de todos os projetos, com o total; o projeto filtra tudo.
  const demandas = pagina.locator(".tabela-demandas");
  await expect(demandas.locator("tbody tr")).toHaveCount(2);
  await expect(demandas.locator('tbody tr:has-text("I-1")')).toContainText(
    /Busca por SKU\s+loja\s+Execução\s+US\$ 90,00/,
  );
  await expect(demandas.locator('tbody tr:has-text("I-2")')).toContainText(
    /Página de contato\s+site\s+Execução\s+US\$ 5,00/,
  );
  await expect(demandas.locator("tfoot")).toContainText("2 demandas");
  await expect(demandas.locator("tfoot")).toContainText("US$ 95,00");
  // O foco continua no primeiro mês, que o período ainda contém (metricas-foco.spec.ts).
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("loja");
  await expect(demandas.locator("tbody tr")).toHaveCount(1);
  await expect(demandas.locator("tfoot")).toContainText("US$ 90,00");
  await expect(custo).toHaveText(/US\$ 10,00\s*sem meses anteriores/);
});

/**
 * Sobre o `semear`: a rodada 1 de I-1, com o Gate da demanda (uma reprovação e uma aprovação), a revisão que exigiu
 * alteração, a devolução do ticket 5, o Gate do PR reprovado e depois aprovado com nota 4, o plano da rodada (a.ts e b.ts) e o commit que alterou só a.ts, em 10 linhas, 3
 * delas reescritas por uma pessoa.
 */
function semearMetricasDeSucesso(raiz: string): void {
  const banco = abrirBancoDaFabriquinha(raiz);
  const sha = (letra: string) => letra.repeat(40);
  const ticket = (n: number, etapa: string, rodada: string) =>
    `('I-1', ${String(n)}, '${etapa}', 'concluido', '${em(M0)}', ${rodada})`;
  const decisao = (ticket: number, id: number, gate: string, resultado: string, nota: string) =>
    `('I-1', ${String(ticket)}, ${String(id)}, '${gate}', '${resultado}', ${nota}, NULL, 'auditor', '${em(M0)}')`;
  const plano = {
    demanda_id: "I-1",
    criterios: [],
    arquivos_previstos: ["a.ts", "b.ts"],
    rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "r", e2e: false, arquivos_previstos: ["a.ts", "b.ts"] }],
    tickets: [
      {
        demanda_id: "I-1",
        ticket_id: 5,
        rodada_id: 1,
        titulo: "t",
        descricao: "d",
        arquivos_previstos: ["a.ts", "b.ts"],
      },
    ],
  };
  banco.exec(`
    INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', '${em(M2)}', 0, 'b1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id) VALUES
      ${ticket(2, "entender_e_desenhar", "NULL")}, ${ticket(3, "revisar_rodada", "1")}, ${ticket(4, "encerrar_rodada", "1")},
      ${ticket(5, "implementar", "1")};
    INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES
      ${decisao(2, 1, "gate_demanda", "reprovado", "NULL")}, ${decisao(2, 2, "gate_demanda", "aprovado", "NULL")},
      ${decisao(3, 1, "gate_revisao_rodada", "reprovado", "NULL")}, ${decisao(4, 1, "gate_pr", "reprovado", "NULL")},
      ${decisao(4, 2, "gate_pr", "aprovado", "4")};
    INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, motivo)
      VALUES ('I-1', 5, 1, '${em(M0)}', '${em(M0)}', 'reprovacao', 'corrija o teste');
    INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados)
      VALUES ('I-1', 1, 'aprovacao_do_planejamento', 'fabriquinha', '${em(M2)}', '${JSON.stringify(plano)}');
    INSERT INTO commit_ticket_demanda VALUES ('${sha("c")}', 'I-1', 5, 'm', '${em(M0)}');
    INSERT INTO arquivo_commit_demanda (sha, caminho, status, adicionadas, removidas) VALUES ('${sha("c")}', 'a.ts', 'A', 10, 0);
    INSERT INTO commit_humano_posterior (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
      VALUES ('${sha("d")}', 'I-1', NULL, 'ana', 5, 3, NULL);
  `);
  banco.close();
}

test("uma seção por Etapa, com o título e as Métricas de Sucesso que o catálogo declara, em Reprovação e Gate", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  semearMetricasDeSucesso(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/metrics`);

  await expect(pagina.locator("section.etapa-metricas")).toHaveCount(SECOES_DE_ETAPA.length);
  const secao = (titulo: string) => pagina.getByRole("region", { name: titulo, exact: true });
  for (const [titulo, rotulos] of SECOES_DE_ETAPA) {
    await expect(secao(titulo).getByRole("heading", { level: 3, name: titulo, exact: true })).toBeVisible();
    await expect(secao(titulo).locator(".rotulo")).toHaveText(rotulos);
  }

  // O valor, a média e a fonte de cada Métrica de Sucesso, e o Uso da Etapa.
  const metrica = (titulo: string, rotulo: string) => secao(titulo).locator(".metrica-sucesso", { hasText: rotulo });
  await expect(metrica("Entender e desenhar", "Reprovações no Gate")).toHaveText(
    /Reprovações no Gate\s*1 de 2 Gates · 1 aprovação\s*média [\s\S]*Gate da demanda/,
  );
  await expect(metrica("Planejar", "Conformidade")).toHaveText(
    /Conformidade do PR com o plano\s*0,50 Jaccard médio · 1 PR\s*média [\s\S]*Plano × arquivos alterados/,
  );
  await expect(metrica("Implementar", "Alterações")).toHaveText(
    /Alterações posteriores no código\s*3 de 10 linhas adicionadas\s*média [\s\S]*Commits humanos posteriores na base/,
  );
  for (const [titulo, reprovacoes] of [
    ["Revisar rodada", "3 reprovações"],
    ["Revisar demanda", "0 reprovações"],
  ] as const) {
    await expect(metrica(titulo, "Exigências")).toContainText(
      new RegExp(`Exigências de alteração\\s*${reprovacoes}\\s*média `),
    );
    await expect(metrica(titulo, "Bugs")).toContainText(
      /Bugs nos arquivos revisados\s*3 linhas alteradas por humanos\s*média /,
    );
  }
  await expect(metrica("Encerrar rodada", "Nota humana")).toHaveText(
    /Nota humana\s*4,0 de 5 · 1 nota\s*média [\s\S]*Gate do PR/,
  );
  await expect(secao("Encerrar demanda")).toContainText("Só Uso: o catálogo não declara outra Métrica.");
  await expect(secao("Implementar").locator(".uso-etapa")).toContainText(/Uso\s*US\$ 65,00\s*média US\$ 2,73/);

  // O vocabulário: Reprovação e Gate, nunca Recusado nem Devolução.
  await expect(pagina.getByText("Reprovações no Gate")).toBeVisible();
  await expect(pagina.getByText("3 reprovações", { exact: true }).first()).toBeVisible();
  // A Reprovação do Gate da demanda, a devolução e as Decisões reprovadas das revisões e do PR: 1 + 1 + 1 + 1.
  const colunaReprovacoes = pagina.locator(".tabela-demandas th", { hasText: /^Reprovações/ });
  const posicao = await colunaReprovacoes.evaluate((th) => [...(th.parentElement?.children ?? [])].indexOf(th));
  await expect(pagina.locator(".tabela-demandas tbody tr", { hasText: "I-1" }).locator("td").nth(posicao)).toHaveText(
    "4",
  );
  await expect(pagina.getByRole("columnheader", { name: "Reprovações" })).toBeVisible();
  await expect(pagina.getByText("nota: média do Gate do PR")).toBeVisible();
  await expect(pagina.getByText(/Recusad|Devolu/)).toHaveCount(0);
});

test("Projeto com os 5 cards do mês", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveText([
    /US\$ 60,00\s*1 execução/,
    /60,5 mil\s*60,0 mil entrada · 500 saída · 0 cache/,
    /0 \/ 0\s*registradas \/ concluídas/,
    /0 \/ 0\s*criados \/ concluídos/,
    /0 \/ 0\s*abertos \/ mergeados/,
    /0 \/ 0\s*linhas alteradas \/ adicionadas/,
  ]);
});

test("o custo com uma sessão sem custo e outra com custo conhecido: o mesmo texto no card, no nível e na demanda", async ({
  pagina,
  fabriquinha,
}) => {
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('loja', '/nao/existe/loja', 'main', 'github', 'loja');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Busca por SKU', 'problema', 'd', 'em_execucao', '${em(M0)}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES
      ('I-1', 1, 'implementar', 'aberto', '${em(M0)}'), ('I-1', 2, 'implementar', 'aberto', '${em(M0)}');
    INSERT INTO trabalho_agentico VALUES ('s-com-custo', 'I-1', 1, 'autonomo', 'c1'), ('s-sem-custo', 'I-1', 2, 'autonomo', 'c2');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES
      ('xc', 's-com-custo', '${em(M0)}', '${em(M0)}', 0), ('xs', 's-sem-custo', '${em(M0)}', '${em(M0)}', 0);
    INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo) VALUES
      ('xc', 'anthropic', 'claude-sonnet-5-5', 1000, 500, 0, 0, 4.2),
      ('xs', 'anthropic', 'claude-sonnet-5-5', 2000, 500, 0, 0, NULL);
  `);
  banco.close();
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/metrics`);
  const texto = "≥ US$ 4,20 (1 sessão sem custo)";
  await expect(pagina.locator('[data-metrica="custo"] .kpi-valor')).toHaveText(texto);
  await expect(pagina.getByRole("row", { name: /^Sessão \d/ })).toContainText(texto);
  await expect(pagina.getByRole("row", { name: /^I-1 / })).toContainText(texto);
  await expect(pagina.getByText("custo incompleto")).toHaveCount(0);
});

test("o custo estimado pelo catálogo: marcado no card, na Etapa, no nível, no modelo e na demanda, distinto do informado", async ({
  pagina,
  fabriquinha,
}, info) => {
  // A subida leu o catálogo de preços do pi (o falso declara o opus e o sonnet).
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  await expect
    .poll(() => banco.prepare("SELECT count(*) AS n FROM preco_do_modelo WHERE origem = 'pi'").get()?.n)
    .toBe(2);
  // Como Sessões grava no fim da execução: a xc com o custo informado pelo pi; a xe sem ele, estimada pelo preço do haiku.
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('loja', '/nao/existe/loja', 'main', 'github', 'loja');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Busca por SKU', 'problema', 'd', 'em_execucao', '${em(M0)}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) VALUES ('I-1', 'em_execucao', '${em(M0)}', 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES
      ('I-1', 1, 'implementar', 'aberto', '${em(M0)}'), ('I-1', 2, 'implementar', 'aberto', '${em(M0)}');
    INSERT INTO trabalho_agentico VALUES ('s-informado', 'I-1', 1, 'autonomo', 'c1'), ('s-estimado', 'I-1', 2, 'autonomo', 'c2');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES
      ('xc', 's-informado', '${em(M0)}', '${em(M0)}', 0), ('xe', 's-estimado', '${em(M0)}', '${em(M0)}', 0);
    INSERT INTO preco_do_modelo (id, modelo_provedor, modelo_nome, usd_por_milhao_entrada, usd_por_milhao_saida,
      usd_por_milhao_cache_leitura, usd_por_milhao_cache_escrita, origem, vigente_de)
      VALUES (100, 'claude-bridge', 'claude-haiku-5-5', 1, 5, 0.1, 1.25, 'pi', '2026-01-01T00:00:00.000Z');
    INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida,
      tokens_cache_leitura, tokens_cache_escrita, custo, preco_id) VALUES
      ('xc', 'anthropic', 'claude-sonnet-5-5', 1000, 500, 0, 0, 4.2, NULL),
      ('xe', 'claude-bridge', 'claude-haiku-5-5', 2000000, 200000, 0, 0, 3, 100);
  `);
  banco.close();
  await pagina.clock.setFixedTime(AGORA);
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.goto(`${fabriquinha.base}/metrics`);
  const texto = "US$ 7,20 (estimado em 1 sessão)";
  const card = pagina.locator('[data-metrica="custo"] .kpi-valor');
  await expect(card).toHaveText(texto);
  await expect(card.locator("small.estimado")).toHaveText("(estimado em 1 sessão)");
  await expect(pagina.getByRole("row", { name: /^Sessão \d/ })).toContainText(texto);
  await expect(
    pagina.getByText(
      "estimado: o pi não informou o custo de 1 sessão; ele foi estimado pelo preço do catálogo de modelos.",
    ),
  ).toBeVisible();
  await expect(pagina.getByRole("row", { name: /^I-1 / })).toContainText(texto);
  // O modelo estimado leva a marca; o informado, não.
  const haiku = pagina.locator(".modelos .uso-modelo", { hasText: "claude-haiku-5-5" });
  await expect(haiku.locator(".vals b")).toHaveText("US$ 3,00 estimado");
  await expect(pagina.locator(".modelos .uso-modelo", { hasText: "claude-sonnet-5-5" }).locator(".vals b")).toHaveText(
    "US$ 4,20",
  );
  // Os tons: o estimado não usa o aviso do custo que falta.
  const corDoEstimado = await card.locator("small.estimado").evaluate((e) => getComputedStyle(e).color);
  expect(corDoEstimado).toBe("rgb(142, 188, 233)");
  await pagina.screenshot({ path: info.outputPath("custo-estimado-metricas-1440.png"), fullPage: true });

  await pagina.goto(`${fabriquinha.base}/demandas/I-1`);
  await expect(pagina.locator(".dm-linha")).toContainText(`Custo ${texto}`);
  await pagina.screenshot({ path: info.outputPath("custo-estimado-demanda-1440.png"), fullPage: true });
});

/**
 * loja com números grandes no mês corrente: US$ 1.351,76 com uma execução sem custo, 24.929 de 289.424 linhas
 * alteradas e mais de mil execuções; o mês anterior tem custo, para os cards mostrarem a média e a variação.
 */
function semearNumerosGrandes(raiz: string): void {
  const banco = abrirBancoDaFabriquinha(raiz);
  const sha = (letra: string) => letra.repeat(40);
  const execucoes = Array.from({ length: 1_200 }, (_, i) => `('x${String(i)}', 's1', '${em(M0)}', '${em(M0)}', 0)`);
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('loja', '/nao/existe/loja', 'main', 'github', 'loja');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Busca por SKU', 'problema', 'd', 'em_execucao', '${em(M1)}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES
      ('I-1', 1, 'implementar', 'concluido', '${em(M0)}'), ('I-1', 2, 'implementar', 'concluido', '${em(M0)}');
    INSERT INTO trabalho_agentico VALUES ('s1', 'I-1', 1, 'autonomo', 'conv1');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ${execucoes.join(", ")},
      ('anterior', 's1', '${em(M1)}', '${em(M1)}', 0);
    INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo) VALUES
      ('x0', 'anthropic', 'claude-sonnet-5-5', 52000000, 900000, 0, 0, 1351.76),
      ('x1', 'anthropic', 'claude-sonnet-5-5', 1000, 10, 0, 0, NULL),
      ('anterior', 'anthropic', 'claude-sonnet-5-5', 30000000, 500000, 0, 0, 980.4);
    INSERT INTO commit_ticket_demanda VALUES ('${sha("a")}', 'I-1', 1, 'm', '${em(M0)}');
    INSERT INTO arquivo_commit_demanda (sha, caminho, status, adicionadas, removidas)
      VALUES ('${sha("a")}', 'a.ts', 'A', 289424, 0);
    INSERT INTO commit_humano_posterior (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
      VALUES ('${sha("b")}', 'I-1', NULL, 'ana', 1, 24929, NULL);
  `);
  banco.close();
}

test("cards do mês: cada legenda inteira ao lado do valor e nenhum card órfão, a 1440 px e empilhados a 375 px", async ({
  pagina,
  fabriquinha,
}, info) => {
  semearNumerosGrandes(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/metrics`);
  const cards = pagina.locator(".kpis .kpi");
  await expect(cards.first()).toContainText("≥ US$ 1.351,76 (1 sessão sem custo)");
  await expect(cards.last()).toContainText("24.929 de 289.424 adicionadas");

  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    const { linhas, legendasQuebradas, larguraDaGrade } = await pagina.locator(".kpis").evaluate((grade) => {
      const caixas = [...grade.querySelectorAll(".kpi")].map((c) => c.getBoundingClientRect());
      // Cada linha da grade: a soma das larguras dos cards e dos vãos entre eles.
      const porLinha = Map.groupBy(caixas, (c) => Math.round(c.top));
      return {
        linhas: [...porLinha.values()].map(
          (cs) => Math.max(...cs.map((c) => c.right)) - Math.min(...cs.map((c) => c.left)),
        ),
        // A legenda inline que quebra vira mais de um retângulo.
        legendasQuebradas: [...grade.querySelectorAll(".kpi-valor small")].filter((s) => s.getClientRects().length > 1)
          .length,
        larguraDaGrade: grade.getBoundingClientRect().width,
      };
    });
    // Toda linha ocupa a largura inteira: nenhum card sobra sozinho com espaço vazio ao lado.
    for (const ocupada of linhas) expect(ocupada, `${String(largura)} px`).toBeCloseTo(larguraDaGrade, 0);
    expect(legendasQuebradas, `${String(largura)} px`).toBe(0);
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pagina.locator(".kpis").screenshot({ path: info.outputPath(`cards-${String(largura)}.png`) });
  }
});
