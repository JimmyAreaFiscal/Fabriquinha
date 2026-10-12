// Métricas (F7 §4.4, §7): mudar o mês em foco faz a média usar só os meses anteriores a ele; o gráfico mostra a dica
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
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness, modelos)
      VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '["npm test"]', '${nome}', '[{"nome":"f","comando":"true","descricao":"d"}]', '{}');`;
  const execucao = (id: number, ticket: number, mes: string, custo: number) =>
    `INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (${String(id)}, ${String(ticket)}, 'autonomo', '${crypto.randomUUID()}', 'sucesso', '${em(mes)}', '${em(mes)}');
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
      VALUES (${String(id)}, 'anthropic', 'claude-sonnet-5-5', 10, ${String(custo * 1000)}, 500, 0, 0, ${String(custo)});`;
  banco.exec(`
    ${projeto("loja")}
    ${projeto("site")}
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'Busca por SKU', 'problema', 'desenvolvimento', '${em(M2)}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (2, 'site', 'Página de contato', 'problema', 'desenvolvimento', '${em(M0)}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (1, 1, 'desenvolvimento', 'Cache', 'aberto', 'fabriquinha', '${em(M2)}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (2, 2, 'desenvolvimento', 'Formulário', 'aberto', 'fabriquinha', '${em(M0)}');
    ${execucao(1, 1, M2, 10)}
    ${execucao(2, 1, M1, 20)}
    ${execucao(3, 1, M0, 60)}
    ${execucao(4, 2, M0, 5)}
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

  // Por issue, de todos os projetos, com o total; o projeto filtra tudo.
  const issues = pagina.locator(".tabela-issues");
  await expect(issues.locator("tbody tr")).toHaveCount(2);
  await expect(issues.locator("tfoot")).toContainText("2 issues");
  await expect(issues.locator("tfoot")).toContainText("US$ 95,00");
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("loja");
  await expect(issues.locator("tbody tr")).toHaveCount(1);
  await expect(custo).toHaveText(/US\$ 60,00\s*média US\$ 15,00/);
});

test("Início com a frase do mês de todos os projetos e Projeto com os 5 cards do mês", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/home`);
  const frase = pagina.locator(".frase-mes");
  await expect(frase).toContainText(", todos os projetos: US$ 65,00 · 66,0 mil tokens");
  await frase.getByRole("link", { name: "Métricas →" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/metrics`);

  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveText([
    /US\$ 60,00\s*10 chamadas de LLM/,
    /60,5 mil\s*60,0 mil entrada · 500 saída · 0 cache/,
    /0 \/ 0\s*registradas \/ concluídas/,
    /0 \/ 0\s*criados \/ concluídos/,
    /0 \/ 0\s*abertos \/ mergeados/,
  ]);
});
