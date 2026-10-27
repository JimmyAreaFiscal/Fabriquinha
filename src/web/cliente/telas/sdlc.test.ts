import assert from "node:assert/strict";
import { test } from "node:test";
import type { Projeto } from "../../../dominio/configuracao_projeto.ts";
import { errosDoZod } from "./configuracao.ts";
import {
  adicionar,
  doProjeto,
  erroPorEtapa,
  estadoInicial,
  formulario,
  linhaEmBranco,
  paraProjeto,
  remover,
  vazio,
} from "./sdlc.ts";

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

test("doProjeto e paraProjeto: a conversão de ida e volta devolve o contrato", () => {
  const estado = doProjeto(FABRIQUINHA);
  assert.equal(estado.etapas.length, 9);
  assert.deepEqual(estado.etapas[1], {
    etapa: "planejar",
    modelo_provedor: "anthropic",
    modelo_nome: "claude",
    effort: "high",
  });
  assert.deepEqual(estado.e2e[0]?.codigo_falha, "1");
  assert.deepEqual(paraProjeto(estado, "fabriquinha"), FABRIQUINHA);
});

test("paraProjeto omite a etapa em branco e o cursor vazio, e usa o nome do caminho", () => {
  const { cursor_commit_humano: _, ...semCursor } = FABRIQUINHA;
  const estado = { ...doProjeto(semCursor), cursor: "" };
  estado.etapas[0] = { etapa: "demanda", modelo_provedor: " ", modelo_nome: "", effort: "" };
  const corpo = paraProjeto(estado, "outro");
  assert.equal(corpo.nome, "outro");
  assert.equal("cursor_commit_humano" in corpo, false);
  assert.deepEqual(
    corpo.etapas.map((e) => e.etapa),
    ["planejar", "revisar_demanda"],
  );
});

test("paraProjeto manda o par incompleto como está, para o servidor recusar, e os números em branco como 0", () => {
  const estado = doProjeto(FABRIQUINHA);
  estado.etapas[1] = { etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "", effort: "" };
  estado.e2e[0] = { ...estado.e2e[0], codigo_falha: "" };
  estado.preparacao.push({ ordem: "", comando: "x" });
  const corpo = paraProjeto(estado, "fabriquinha");
  assert.deepEqual(corpo.etapas[0], { etapa: "planejar", modelo_provedor: "anthropic" });
  assert.equal(corpo.e2e[0]?.codigo_falha, 0);
  assert.deepEqual(corpo.preparacao[1], { ordem: 0, comando: "x" });
  const sem = doProjeto(FABRIQUINHA);
  sem.preparacao.push({ ordem: "2" });
  assert.equal(paraProjeto(sem, "f").preparacao[1]?.comando, "");
  sem.etapas[0] = { etapa: "demanda" };
  assert.equal(paraProjeto(sem, "f").etapas.length, 2);
});

test("erroPorEtapa troca o índice da lista enviada pelo nome da etapa", () => {
  const erros = errosDoZod(
    "✖ informe\n  → at etapas[0].modelo_nome\n✖ outra\n  → at etapas[7].effort\n✖ x\n  → at fitness[0].nome",
  );
  assert.deepEqual(
    [...erroPorEtapa(erros, ["planejar"])],
    [
      ["etapas[planejar].modelo_nome", ["informe"]],
      ["etapas[7].effort", ["outra"]],
      ["fitness[0].nome", ["x"]],
    ],
  );
});

test("adicionar põe uma linha em branco no fim do grupo e remover tira a linha pelo índice", () => {
  const estado = doProjeto({
    ...FABRIQUINHA,
    fitness: [...FABRIQUINHA.fitness, { nome: "b", comando: "c", descricao: "d" }],
  });
  const mais = adicionar(estado, "fitness");
  assert.equal(mais.fitness.length, 3);
  assert.deepEqual(mais.fitness[2], { nome: "", comando: "", descricao: "" });
  assert.deepEqual(linhaEmBranco("preparacao"), { ordem: "", comando: "" });
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
  assert.equal(inicial.etapas.length, 9);
});

test("formulario mostra os sete grupos com os valores, Adicionar por grupo e Remover por linha", () => {
  const html = formulario("fabriquinha", doProjeto(FABRIQUINHA), { erros: new Map() });
  for (const g of ["Projeto", "Etapas", "Preparação", "Fitness", "Linguagens", "E2E", "Globs"])
    assert.match(html, new RegExp(`data-grupo="[a-z0-9]+" aria-label="${g}"`));
  assert.match(html, /data-campo="branch_base" value="develop"/);
  assert.match(html, /data-campo="raiz_git" value="\/code\/fab" readonly/);
  assert.match(html, /<input type="hidden" data-campo="cursor" value="abc123">/);
  assert.match(html, /aria-label="Nome do modelo da etapa planejar"/);
  assert.match(html, /<option value="high" selected>high<\/option>/);
  assert.match(html, /value="Cobertura &#60;mínima&#62;\."/);
  assert.equal(html.match(/data-adicionar=/g)?.length, 5);
  assert.equal(html.match(/data-remover>Remover/g)?.length, 5);
  assert.match(html, /href="\/config\?projeto=fabriquinha">Cadastro do projeto/);
  assert.doesNotMatch(html, /msg-erro|Configuração salva/);
});

test("formulario põe cada erro no campo certo, no grupo e no rodapé", () => {
  const erros = errosDoZod(
    [
      "✖ informe provedor e nome do modelo juntos ou nenhum\n  → at etapas[planejar].modelo_nome",
      "✖ use um valor de 1 a 255\n  → at e2e[0].codigo_falha",
      "✖ E2E exige ao menos um glob\n  → at e2e",
      "✖ ordem repetida\n  → at preparacao",
    ].join("\n"),
  );
  const html = formulario("fabriquinha", doProjeto(FABRIQUINHA), { erros, falha: "raiz_git <ruim>", salvo: true });
  assert.match(
    html,
    /id="campo-etapas\[planejar\]\.modelo_nome"[^>]*aria-invalid="true"[^>]*>[^]*?>informe provedor e nome do modelo juntos ou nenhum</,
  );
  assert.match(html, /id="campo-e2e\[0\]\.codigo_falha-erro">use um valor de 1 a 255</);
  assert.match(html, /<h3>E2E [^]*?<\/h3><span class="msg-erro" id="campo-e2e-erro">E2E exige ao menos um glob/);
  assert.match(html, /id="campo-preparacao-erro">ordem repetida/);
  assert.match(html, /role="alert">raiz_git &#60;ruim&#62;/);
  assert.match(html, /Configuração salva\./);
  assert.match(html, /4 campos com erro/);
  assert.match(
    formulario("f", doProjeto(FABRIQUINHA), { erros: errosDoZod("✖ x\n  → at branch_base") }),
    /1 campo com erro/,
  );
});

test("formulario trata a linha com campo ausente como vazio", () => {
  const estado = { ...doProjeto(FABRIQUINHA), fitness: [{ nome: "x" }] };
  assert.match(formulario("f", estado, { erros: new Map() }), /data-campo="comando" value=""/);
});
