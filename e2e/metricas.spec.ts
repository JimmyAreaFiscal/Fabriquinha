// Métricas (F7 §4.4, §7), lidas das tabelas da demanda: mudar o mês em foco faz a média usar só os meses anteriores a ele; o gráfico mostra a dica
// e troca o foco no clique; o Início mostra a frase do mês e o Projeto, os 5 cards do mês.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

/** O agora do navegador, fixo em outubro de 2026: o mês corrente é M0, e o período padrão vai de nov/25 a out/26. */
const AGORA = new Date(2026, 9, 15, 12, 0);
const [M2, M1, M0] = ["2026-08", "2026-09", "2026-10"];

/** O dia 1º do mês ao meio-dia, no fuso local (o do serviço), como o banco grava: em UTC. */
const em = (mes: string) => new Date(`${mes}-01T12:00:00`).toISOString();

/** loja: I-1 com execuções de US$ 10, 20 e 60 nos três últimos meses; site: I-2 com US$ 5 no mês corrente. */
function semear(raiz: string): void {
  const banco = abrir(raiz);
  const projeto = (nome: string) =>
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
      VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '${nome}');`;
  const demanda = (id: string, nome: string, titulo: string, mes: string) =>
    `INSERT INTO demanda VALUES ('${id}', '${nome}', '${titulo}', 'problema', 'd', 'execucao', '${em(mes)}', 'f', 's', 1, 'b-${id}');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', '${em(mes)}');`;
  const execucao = (id: number, demandaId: string, mes: string, custo: number) =>
    `INSERT INTO sessao VALUES ('s${String(id)}', '${demandaId}', 1, 'autonomo', 'conv${String(id)}');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('x${String(id)}', 's${String(id)}', '${em(mes)}', '${em(mes)}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('x${String(id)}', 'anthropic', 'claude-sonnet-5-5', ${String(custo * 1000)}, 500, 0, 0, ${String(custo)});`;
  banco.exec(`
    ${projeto("loja")}
    ${projeto("site")}
    ${demanda("I-1", "loja", "Busca por SKU", M2)}
    ${demanda("I-2", "site", "Página de contato", M0)}
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
  await expect(demandas.locator("tfoot")).toContainText("2 demandas");
  await expect(demandas.locator("tfoot")).toContainText("US$ 95,00");
  // O foco continua no primeiro mês, que o período ainda contém (metricas-foco.spec.ts).
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("loja");
  await expect(demandas.locator("tbody tr")).toHaveCount(1);
  await expect(demandas.locator("tfoot")).toContainText("US$ 90,00");
  await expect(custo).toHaveText(/US\$ 10,00\s*sem meses anteriores/);
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

/**
 * loja com números grandes no mês corrente: US$ 1.351,76 com uma execução sem custo, 24.929 de 289.424 linhas
 * alteradas e mais de mil execuções; o mês anterior tem custo, para os cards mostrarem a média e a variação.
 */
function semearNumerosGrandes(raiz: string): void {
  const banco = abrir(raiz);
  const sha = (letra: string) => letra.repeat(40);
  const execucoes = Array.from({ length: 1_200 }, (_, i) => `('x${String(i)}', 's1', '${em(M0)}', '${em(M0)}', 0)`);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
      VALUES ('loja', '/nao/existe/loja', 'main', 'github', 'loja');
    INSERT INTO demanda VALUES ('I-1', 'loja', 'Busca por SKU', 'problema', 'd', 'execucao', '${em(M1)}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES
      ('I-1', 1, 'implementar', 'concluido', '${em(M0)}'), ('I-1', 2, 'implementar', 'concluido', '${em(M0)}');
    INSERT INTO sessao VALUES ('s1', 'I-1', 1, 'autonomo', 'conv1');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ${execucoes.join(", ")},
      ('anterior', 's1', '${em(M1)}', '${em(M1)}', 0);
    INSERT INTO uso_modelo_execucao VALUES
      ('x0', 'anthropic', 'claude-sonnet-5-5', 52000000, 900000, 0, 0, 1351.76),
      ('x1', 'anthropic', 'claude-sonnet-5-5', 1000, 10, 0, 0, NULL),
      ('anterior', 'anthropic', 'claude-sonnet-5-5', 30000000, 500000, 0, 0, 980.4);
    INSERT INTO commit_ticket_demanda VALUES ('${sha("a")}', 'I-1', 1, 'm', '${em(M0)}');
    INSERT INTO arquivo_commit_demanda (sha, caminho, status, adicionadas, removidas)
      VALUES ('${sha("a")}', 'a.ts', 'A', 289424, 0);
    INSERT INTO retrabalho_demanda (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
      VALUES ('${sha("b")}', 'I-1', 2, NULL, 1, 24929, 'I-1');
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
  await expect(cards.first()).toContainText("US$ 1.351,76 * custo incompleto");
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
