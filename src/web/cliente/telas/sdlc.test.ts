import assert from "node:assert/strict";
import { test } from "node:test";
import type { Projeto } from "../../../dominio/configuracao_projeto.ts";
import { errosDoZod } from "./configuracao.ts";
import { adicionar, doProjeto, estadoInicial, formulario, linhaEmBranco, paraProjeto, remover, vazio } from "./sdlc.ts";

const FABRIQUINHA: Projeto = {
  nome: "fabriquinha",
  branch_base: "develop",
  chave_sonarqube: "fab",
  raiz_git: "/code/fab",
  hospedagem: "github",
  cursor_commit_humano: "abc123",
  etapas: [
    { etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude", effort: "high" },
    { etapa: "revisar_demanda", effort: "low" },
  ],
  preparacao: [{ ordem: 1, comando: "npm ci" }],
  fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura <mínima>." }],
  linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
  e2e: [{ caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 }],
  globs: [{ caminho_linguagem: ".", glob: "e2e/**/*.spec.ts" }],
};

test("doProjeto e paraProjeto: a conversão de ida e volta devolve o contrato sem as etapas e a preparação, que são do cadastro", () => {
  const estado = doProjeto(FABRIQUINHA);
  assert.equal("etapas" in estado, false);
  assert.equal("preparacao" in estado, false);
  assert.deepEqual(estado.e2e[0]?.codigo_falha, "1");
  const { etapas: _, preparacao: __, ...doCadastroDaSdlc } = FABRIQUINHA;
  assert.deepEqual(paraProjeto(estado, "fabriquinha"), doCadastroDaSdlc);
});

test("paraProjeto omite o cursor vazio e usa o nome do caminho", () => {
  const { cursor_commit_humano: _, ...semCursor } = FABRIQUINHA;
  const estado = { ...doProjeto(semCursor), cursor: "" };
  const corpo = paraProjeto(estado, "outro");
  assert.equal(corpo.nome, "outro");
  assert.equal("cursor_commit_humano" in corpo, false);
});

test("paraProjeto manda os números em branco como 0, para o servidor recusar", () => {
  const estado = doProjeto(FABRIQUINHA);
  estado.e2e[0] = { ...estado.e2e[0], codigo_falha: "" };
  assert.equal(paraProjeto(estado, "fabriquinha").e2e[0]?.codigo_falha, 0);
});

test("adicionar põe uma linha em branco no fim do grupo e remover tira a linha pelo índice", () => {
  const estado = doProjeto({
    ...FABRIQUINHA,
    fitness: [...FABRIQUINHA.fitness, { nome: "b", comando: "c", descricao: "d" }],
  });
  const mais = adicionar(estado, "fitness");
  assert.equal(mais.fitness.length, 3);
  assert.deepEqual(mais.fitness[2], { nome: "", comando: "", descricao: "" });
  assert.deepEqual(linhaEmBranco("globs"), { caminho_linguagem: "", glob: "" });
  assert.deepEqual(
    remover(mais, "fitness", 0).fitness.map((f) => f.nome),
    ["b", ""],
  );
  assert.equal(estado.fitness.length, 2);
});

test("vazio diz que não há configuração e o estado inicial abre uma fitness e uma linguagem em branco", () => {
  const html = vazio("lo<ja>");
  assert.match(html, /O projeto lo&#60;ja&#62; ainda não tem configuração SDLC\./);
  assert.match(html, /data-criar>Criar configuração/);
  assert.doesNotMatch(html, /data-grupo/);
  const inicial = estadoInicial(
    doProjeto({ ...FABRIQUINHA, fitness: [], linguagens: [], e2e: [], globs: [], preparacao: [] }),
  );
  assert.equal(inicial.fitness.length, 1);
  assert.equal(inicial.linguagens.length, 1);
});

test("formulario mostra os cinco grupos com os valores, Adicionar por grupo e Remover por linha; as etapas e a preparação não", () => {
  const html = formulario("fabriquinha", doProjeto(FABRIQUINHA), { erros: new Map() });
  for (const g of ["Projeto", "Fitness", "Linguagens", "E2E", "Globs"])
    assert.match(html, new RegExp(`data-grupo="[a-z0-9]+" aria-label="${g}"`));
  assert.equal(html.match(/data-grupo=/g)?.length, 5);
  assert.doesNotMatch(html, /Etapas|Preparação|npm ci|<select|tela legada/);
  assert.match(html, /a preparação da worktree e o modelo e o effort de cada etapa só se editam no cadastro\./);
  assert.match(html, /A branch base é a do cadastro do projeto, na Configuração: mudar aqui muda lá\./);
  assert.match(html, /data-campo="branch_base" value="develop"/);
  assert.match(html, /data-campo="raiz_git" value="\/code\/fab" readonly/);
  assert.match(html, /<input type="hidden" data-campo="cursor" value="abc123">/);
  assert.match(html, /value="Cobertura &#60;mínima&#62;\."/);
  assert.equal(html.match(/data-adicionar=/g)?.length, 4);
  assert.equal(html.match(/data-remover>Remover/g)?.length, 4);
  assert.match(html, /href="\/config\?projeto=fabriquinha">Cadastro do projeto/);
  assert.doesNotMatch(html, /msg-erro|Configuração salva/);
});

test("formulario põe cada erro no campo certo, no grupo e no rodapé", () => {
  const erros = errosDoZod(
    [
      "✖ use um valor de 1 a 255\n  → at e2e[0].codigo_falha",
      "✖ E2E exige ao menos um glob\n  → at e2e",
      "✖ nome de fitness function repetido\n  → at fitness",
    ].join("\n"),
  );
  const html = formulario("fabriquinha", doProjeto(FABRIQUINHA), { erros, falha: "raiz_git <ruim>", salvo: true });
  assert.match(html, /id="campo-e2e\[0\]\.codigo_falha-erro">use um valor de 1 a 255</);
  assert.match(html, /<h3>E2E [^]*?<\/h3><span class="msg-erro" id="campo-e2e-erro">E2E exige ao menos um glob/);
  assert.match(html, /id="campo-fitness-erro">nome de fitness function repetido/);
  assert.match(html, /role="alert">raiz_git &#60;ruim&#62;/);
  assert.match(html, /Configuração salva\./);
  assert.match(html, /3 campos com erro/);
  assert.match(
    formulario("f", doProjeto(FABRIQUINHA), { erros: errosDoZod("✖ x\n  → at branch_base") }),
    /1 campo com erro/,
  );
});

test("formulario trata a linha com campo ausente como vazio", () => {
  const estado = { ...doProjeto(FABRIQUINHA), fitness: [{ nome: "x" }] };
  assert.match(formulario("f", estado, { erros: new Map() }), /data-campo="comando" value=""/);
});
