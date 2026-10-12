import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agendador,
  errosDoZod,
  type EstadoDaConfiguracao,
  formularioDeProjeto,
  menu,
  NOVO,
  pagina,
  type ProjetoListado,
  projetoInexistente,
  selecao,
} from "./configuracao.ts";

// A hora da próxima busca sai no fuso do navegador; aqui, um fuso fixo.
process.env.TZ = "America/Sao_Paulo";

const LOJA: ProjetoListado = {
  nome: "loja",
  repo: "/code/loja",
  branchBase: "main",
  hospedagem: "github",
  preparacao: ["npm ci"],
  testes: ["npm test"],
  sonar: { projectKey: "loja" },
  fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura <mínima>." }],
  modelos: { desenho: { provedor: "anthropic", modelo: "claude-opus-5-5" } },
  issues: 1,
};

const MODELOS = [
  { provedor: "anthropic", modelo: "claude-opus-5-5" },
  { provedor: "anthropic", modelo: "claude-sonnet-5-5" },
];

test("selecao: o item do menu pelo endereço", () => {
  assert.deepEqual(selecao(""), { tipo: "agendador" });
  assert.deepEqual(selecao("?projeto=loja%20x"), { tipo: "projeto", nome: "loja x" });
  assert.deepEqual(selecao("?projeto="), { tipo: "agendador" });
  assert.deepEqual(selecao("?novo"), { tipo: "novo" });
});

test("errosDoZod: as mensagens por caminho do prettifyError; sem caminho, na raiz", () => {
  const erros = errosDoZod(
    "✖ Pequeno demais\n  → at fitness[0].nome\n✖ nome repetido\n  → at fitness\n✖ outro\n  → at fitness\n✖ Entrada inválida",
  );
  assert.deepEqual(
    [...erros],
    [
      ["fitness[0].nome", ["Pequeno demais"]],
      ["fitness", ["nome repetido", "outro"]],
      ["", ["Entrada inválida"]],
    ],
  );
  assert.equal(errosDoZod("o corpo não é JSON válido").size, 0);
});

test("menu: Agendador com a marca, um link por projeto com a hospedagem e o novo; o escolhido marcado", () => {
  const ligado = { agendadorAtivo: true, intervaloMin: 5, timeoutMin: 120, ociosidadeMin: 30 };
  const azure = { ...LOJA, nome: "site<x>", hospedagem: "azure-devops" as const };
  const html = menu(ligado, [LOJA, azure], { tipo: "projeto", nome: "loja" });
  assert.match(html, /<a href="\/config">Agendador <span class="pill pill-ok">ligado<\/span><\/a>/);
  assert.match(html, /<a href="\/config\?projeto=loja" aria-current="page">loja<span class="muted hospedagem">GitHub</);
  assert.match(
    html,
    /<a href="\/config\?projeto=site%3Cx%3E">site&#60;x&#62;<span class="muted hospedagem">Azure DevOps</,
  );
  assert.match(html, /<a class="novo" href="\/config\?novo">\+ Novo projeto<\/a>/);

  const desligado = menu({ ...ligado, agendadorAtivo: false }, [], { tipo: "agendador" });
  assert.match(desligado, /<a href="\/config" aria-current="page">Agendador <span class="pill pill-neutro">desligado/);
  assert.match(menu(ligado, [], { tipo: "novo" }), /<a class="novo" href="\/config\?novo" aria-current="page">/);
});

const ESTADO: EstadoDaConfiguracao = {
  agendadorAtivo: true,
  intervaloMin: 5,
  timeoutMin: 120,
  ociosidadeMin: 30,
  proximaBusca: "2026-10-12T17:35:00.000Z",
  emAndamento: { execucao: 231, ticket: 112, issue: 38, iniciadaEm: "2026-10-12T17:24:00.000Z" },
};

test("agendador: interruptor, os três tempos, a próxima busca no fuso local e a execução com há quanto tempo", () => {
  const html = agendador(ESTADO, new Map(), new Date("2026-10-12T17:30:30.000Z"));
  assert.match(html, /<input type="checkbox" name="agendadorAtivo" checked>/);
  assert.match(
    html,
    /<label for="campo-intervaloMin">Procurar a cada<\/label><span class="com-unidade"><input type="number" id="campo-intervaloMin" name="intervaloMin" value="5" min="1" max="1440"> min/,
  );
  assert.match(html, /name="timeoutMin" value="120" min="10"/);
  assert.match(html, /name="ociosidadeMin" value="30" min="5"/);
  assert.match(html, /Próxima busca às <b>14:35<\/b>/);
  assert.match(html, /Executando <b>E-231<\/b> · I-38 · T-112 · há 6 min/);

  const em = (agora: string) => agendador(ESTADO, new Map(), new Date(agora));
  assert.match(em("2026-10-12T17:24:59.000Z"), /há menos de 1 min/);
  assert.match(em("2026-10-12T19:29:00.000Z"), /há 2 h 5 min/);

  const parado = agendador(
    { ...ESTADO, agendadorAtivo: false, proximaBusca: null, emAndamento: null },
    errosDoZod("✖ Pequeno demais: esperava que o número fosse >= 1\n  → at intervaloMin"),
    new Date(),
  );
  assert.match(parado, /<input type="checkbox" name="agendadorAtivo">/);
  assert.match(parado, /Desligado: <b>não procura tickets<\/b>/);
  assert.match(parado, /Nenhuma execução autônoma em andamento/);
  assert.match(
    parado,
    /<div class="num-campo erro">.*aria-invalid="true" aria-describedby="campo-intervaloMin-erro"> min<\/span><span class="msg-erro" id="campo-intervaloMin-erro">Pequeno demais: esperava que o número fosse &#62;= 1<\/span><\/div>/,
  );
});

test("projeto salvo: nome só leitura, hospedagem, as listas, as fitness e o modelo de cada etapa", () => {
  const html = formularioDeProjeto(LOJA, { issues: 1, modelos: MODELOS, erros: new Map() });
  assert.match(html, /^<h2>loja <span class="muted contagem">1 issue<\/span><\/h2>/);
  assert.match(html, /<input id="campo-nome" name="nome" value="loja" readonly>/);
  assert.match(html, /<input id="campo-hospedagem" value="GitHub" readonly>/);
  assert.match(
    html,
    /<input class="mono" value="npm ci" placeholder="npm ci" aria-label="Preparação da worktree: comando 1">/,
  );
  assert.match(html, /<input class="mono" value="npm test" placeholder="npm test" aria-label="Testes: comando 1">/);
  assert.match(html, /data-campo="descricao" value="Cobertura &#60;mínima&#62;."/);
  assert.match(
    html,
    /<select id="campo-modelos.desenho" name="modelos.desenho"><option value="">padrão do pi<\/option><option value="anthropic\/claude-opus-5-5" selected>anthropic \/ claude-opus-5-5<\/option><option value="anthropic\/claude-sonnet-5-5">/,
  );
  assert.match(
    html,
    /<select id="campo-modelos.revisao" name="modelos.revisao" class="padrao"><option value="">padrão/,
  );
  assert.match(html, /<label for="campo-modelos.sessao">Sessão em aberto<\/label>/);
  assert.match(
    html,
    /<span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.<\/span><button/,
  );
  assert.match(html, /<button type="submit" class="btn btn-primario">Salvar projeto<\/button>/);
  assert.match(formularioDeProjeto(LOJA, { issues: 11, modelos: MODELOS, erros: new Map() }), /11 issues/);
});

test("o modelo gravado que o pi deixou de listar continua no seletor, escolhido", () => {
  const html = formularioDeProjeto(
    { ...LOJA, modelos: { desenho: { provedor: "llamacpp", modelo: "qwen" } } },
    { issues: 0, modelos: MODELOS, erros: new Map() },
  );
  assert.match(
    html,
    /claude-sonnet-5-5<\/option><option value="llamacpp\/qwen" selected>llamacpp \/ qwen<\/option><\/select>/,
  );
});

test("novo projeto: o nome editável com a ajuda; os erros ao lado de cada campo e quantos no rodapé", () => {
  const erros = errosDoZod(
    [
      "✖ use letras minúsculas\n  → at nome",
      "✖ caminho absoluto\n  → at repo",
      "✖ Pequeno demais\n  → at testes",
      "✖ Pequeno demais\n  → at preparacao[0]",
      "✖ nome de fitness function repetido\n  → at fitness",
      "✖ Pequeno demais\n  → at fitness[0].comando",
      "✖ o modelo x/y não existe no pi\n  → at modelos.revisao",
      "✖ Texto inválido\n  → at modelos.desenho.provedor",
    ].join("\n"),
  );
  const html = formularioDeProjeto({ ...NOVO, preparacao: [""] }, { modelos: MODELOS, erros });
  assert.match(html, /^<h2>Novo projeto<\/h2>/);
  assert.match(
    html,
    /<div class="campo erro"><label for="campo-nome">Nome<\/label><input id="campo-nome" name="nome" value="" placeholder="loja-api" aria-invalid="true" aria-describedby="campo-nome-erro"><span class="msg-erro" id="campo-nome-erro">use letras minúsculas<\/span><span class="ajuda">letras minúsculas, números e hífen; não muda depois<\/span><\/div>/,
  );
  assert.match(html, /<div class="campo largo erro"><label for="campo-repo">/);
  assert.match(html, /<input id="campo-hospedagem" value="deduzida do remoto ao salvar" readonly>/);
  assert.match(
    html,
    /<div class="campo erro" data-lista="testes">.*<span class="msg-erro" id="campo-testes-erro">Pequeno demais<\/span><button type="button" class="link" data-adicionar="testes">/,
  );
  assert.match(
    html,
    /<div class="item-lista erro"><input class="mono" value="" placeholder="npm ci" aria-label="Preparação da worktree: comando 1" aria-invalid="true" aria-describedby="campo-preparacao\[0\]-erro">/,
  );
  assert.match(
    html,
    /<div class="lista erro">.*<span class="msg-erro" id="campo-fitness-erro">nome de fitness function repetido<\/span><button type="button" class="link" data-adicionar="fitness">/,
  );
  assert.match(html, /<div class="celula erro"><input class="mono" data-campo="comando"/);
  assert.match(
    html,
    /<div class="celula erro"><select id="campo-modelos.revisao" name="modelos.revisao" class="padrao" aria-invalid="true"/,
  );
  assert.match(html, /<span class="msg-erro" id="campo-modelos.desenho-erro">Texto inválido<\/span>/);
  assert.match(
    html,
    /<span class="msg-erro">8 campos com erro<\/span><button type="button" class="btn" data-cancelar>Cancelar<\/button><button type="submit" class="btn btn-primario">Cadastrar projeto/,
  );
  assert.match(
    formularioDeProjeto(NOVO, { modelos: [], erros: errosDoZod("✖ caminho absoluto\n  → at repo") }),
    /<span class="msg-erro">1 campo com erro<\/span>/,
  );
});

test("a falha que não é de campo (F5, C19) fica no rodapé, junto da nota e da contagem, que ficam", () => {
  const html = formularioDeProjeto(NOVO, {
    modelos: [],
    erros: new Map([["nome", ["obrigatório"]]]),
    falha: "o gh não está autenticado <x>",
  });
  assert.match(
    html,
    /<div class="rodape-form"><span class="msg-erro falha" role="alert">o gh não está autenticado &#60;x&#62;<\/span><span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.<\/span><span class="msg-erro">1 campo com erro<\/span><button/,
  );
});

test("página: cabeçalho, menu e painel; projeto do endereço que não existe", () => {
  assert.equal(
    pagina("<nav></nav>", "<h2>x</h2>"),
    '<div class="cabeca-pagina"><h1>Configuração</h1></div><div class="config"><nav></nav><section class="painel-config superficie"><h2>x</h2></section></div>',
  );
  assert.match(
    projetoInexistente("a<b"),
    /O projeto a&#60;b não está cadastrado\. <a class="link" href="\/config\?novo">/,
  );
});
