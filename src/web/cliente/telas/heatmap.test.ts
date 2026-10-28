import assert from "node:assert/strict";
import { test } from "node:test";
import type { Heatmap, NoDoHeatmap } from "../../../repositorio/heatmap.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { caminhoDoHeatmap, calor, conteudo, cor, erroDoHeatmap, linhas, paginaDoHeatmap } from "./heatmap.ts";

const projeto = (nome: string): ProjetoListado => ({
  nome,
  repo: `/repos/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  sonar: { projectKey: nome },
});
const PROJETOS = [projeto("fabriquinha"), projeto("loja <api>")];

const arquivo = (nome: string, commits: string[]): NoDoHeatmap => ({ nome, alteracoes: commits.length, commits });

const DADOS: Heatmap = {
  branch: "main",
  desde: "2025-10-12T12:00:00.000Z",
  ate: "2026-10-12T12:00:00.000Z",
  raiz: {
    nome: "fabriquinha",
    alteracoes: 6,
    filhos: [
      {
        nome: "src",
        alteracoes: 5,
        filhos: [arquivo('a"<b>.ts', ["h1", "h2", "h3", "h4", "h5"])],
      },
      arquivo("velho.md", []),
      arquivo("b.ts", ["h6"]),
    ],
  },
  commits: {
    h1: { hash: "1111111aaaa", mensagem: "feat: <um>", data: "2026-10-12T12:00:00.000Z", pr: "7" },
    h2: { hash: "2222222bbbb", mensagem: "fix", data: "2026-03-05T12:00:00.000Z", pr: null },
    h3: { hash: "3333333cccc", mensagem: "x", data: "2026-03-05T12:00:00.000Z", pr: null },
    h4: { hash: "4444444dddd", mensagem: "y", data: "2026-03-05T12:00:00.000Z", pr: null },
    h5: { hash: "5555555eeee", mensagem: "z", data: "2026-03-05T12:00:00.000Z", pr: null },
    h6: { hash: "6666666ffff", mensagem: "w", data: "2026-03-05T12:00:00.000Z", pr: null },
  },
};

test("calor cresce com as alterações em escala logarítmica, de 0 ao total, e é 0 se o total é 0", () => {
  assert.equal(calor(0, 900), 0);
  assert.equal(calor(900, 900), 1);
  assert.ok(calor(5, 900) < calor(6, 900));
  assert.ok(calor(305, 900) > 0.5);
  assert.equal(calor(0, 0), 0);
});

test("cor vai do azul (frio) ao vermelho (quente)", () => {
  assert.equal(cor(0), "hsl(220 70% 50%)");
  assert.equal(cor(1), "hsl(0 70% 50%)");
});

test("caminhoDoHeatmap codifica o nome do projeto", () => {
  assert.equal(caminhoDoHeatmap("loja <api>"), "/projects/loja%20%3Capi%3E/heatmap");
});

test("linhas: um <details> por filho, com cor, nome, total e barra; pasta com barra no nome", () => {
  const html = linhas(DADOS.raiz.filhos ?? [], 6, "pai");
  assert.equal(html.match(/<details /g)?.length, 3);
  assert.match(html, /data-caminho="pai\/src"/);
  assert.match(html, /class="hm-nome">src\/<\/span><span class="hm-total">5<\/span>/);
  assert.match(html, /class="hm-nome">velho\.md<\/span><span class="hm-total">0<\/span>/);
  // Sem alterações: a cor mais fria e a barra vazia.
  assert.match(html, /<i style="width:0%;background:hsl\(220 70% 50%\)"><\/i>/);
  // Sem pai, o caminho é só o nome.
  assert.match(linhas([arquivo("b.ts", ["h6"])], 1), /data-caminho="b\.ts"/);
});

test("conteúdo de uma pasta: as linhas dos filhos, com o caminho dela", () => {
  const html = conteudo(DADOS.raiz, "src", 6, DADOS.commits);
  assert.match(html, /^<div class="hm-filhos"><details [^>]*data-caminho="src\/a&#34;&#60;b&#62;\.ts"/);
});

test("conteúdo de um arquivo: a métrica e os commits com hash curto, data, PR ou sem PR, tudo escapado", () => {
  const html = conteudo(DADOS.raiz, 'src/a"<b>.ts', 6, DADOS.commits);
  assert.match(html, /Código alterado: 5 alterações<\/strong> · quanto maior, pior/);
  assert.match(
    html,
    /<td class="hm-hash">1111111<\/td><td>feat: &#60;um&#62;<\/td><td class="hm-data">12\/10\/2026<\/td><td class="hm-pr">PR #7<\/td>/,
  );
  assert.match(html, /<td class="hm-data">05\/03\/2026<\/td><td class="hm-pr">sem PR<\/td>/);
  assert.equal(html.match(/<tr>/g)?.length, 6); // o cabeçalho e os 5 commits
  assert.doesNotMatch(html, /<b>/);
});

test("conteúdo de um arquivo sem alterações: 0 e nenhum commit listado; com 1, no singular", () => {
  const velho = conteudo(DADOS.raiz, "velho.md", 6, DADOS.commits);
  assert.match(velho, /Código alterado: 0 alterações/);
  assert.doesNotMatch(velho, /<table/);
  assert.match(conteudo(DADOS.raiz, "b.ts", 6, DADOS.commits), /Código alterado: 1 alteração<\/strong>/);
});

test("a página: seletor, abas com Heatmap ativa, janela em datas, branch, total e a raiz", () => {
  const html = paginaDoHeatmap(PROJETOS, "fabriquinha", DADOS);
  assert.match(html, /<option selected>fabriquinha<\/option>/);
  assert.match(html, /<a href="\/projects\/fabriquinha\/heatmap" aria-current="page">Heatmap<\/a>/);
  assert.match(html, /Janela <strong>12\/10\/2025<\/strong> a <strong>12\/10\/2026<\/strong>/);
  assert.match(html, /branch <strong class="hm-branch">main<\/strong>/);
  assert.match(html, /<strong>6 alterações<\/strong> no projeto/);
  assert.equal(html.match(/<details /g)?.length, 3);
  assert.doesNotMatch(html, /Nenhuma alteração/);
});

test("sem alterações na janela: a mensagem e todos os totais em 0", () => {
  const parado: Heatmap = { ...DADOS, raiz: { nome: "r", alteracoes: 0, filhos: [arquivo("a.ts", [])] }, commits: {} };
  const html = paginaDoHeatmap(PROJETOS, "fabriquinha", parado);
  assert.match(html, /Nenhuma alteração nos últimos 12 meses/);
  assert.match(html, /<strong>0 alterações<\/strong> no projeto/);
  assert.match(html, /class="hm-total">0<\/span>/);
});

test("o erro do git aparece sob as abas, com o motivo e a correção escapados", () => {
  const html = erroDoHeatmap(PROJETOS, "loja <api>", "o repositório <x> sumiu (corrija)");
  assert.match(html, /aria-current="page">Heatmap<\/a>/);
  assert.match(
    html,
    /Não foi possível montar o heatmap\.<\/strong><p>o repositório &#60;x&#62; sumiu \(corrija\)<\/p>/,
  );
});
