import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agendador,
  confirmacaoDeRemover,
  errosDoZod,
  type EstadoDaConfiguracao,
  formularioDeProjeto,
  menu,
  NOVO,
  pagina,
  type ProjetoListado,
  projetoInexistente,
  selecao,
  usuariosSimulados,
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
  const ligado = { agendadorAtivo: true, intervaloMin: 5, timeoutMin: 120, ociosidadeMin: 30, modeloAuditoria: null };
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
  modeloAuditoria: null,
  proximaBusca: "2026-10-12T17:35:00.000Z",
  emAndamento: [
    { execucao: 231, ticket: 112, issue: 38, iniciadaEm: "2026-10-12T17:24:00.000Z" },
    { execucao: 232, ticket: 120, issue: 40, iniciadaEm: "2026-10-12T17:25:00.000Z" },
  ],
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
  assert.match(html, /<span>Executando <b>E-231<\/b> · I-38 · T-112 · há 6\u00a0min<\/span>/);
  assert.match(html, /<span>Executando <b>E-232<\/b> · I-40 · T-120 · há 5\u00a0min<\/span>/);
  assert.doesNotMatch(html, /Nenhuma execução autônoma/);

  const em = (agora: string) => agendador(ESTADO, new Map(), new Date(agora));
  assert.match(em("2026-10-12T17:24:59.000Z"), /há menos\u00a0de\u00a01\u00a0min/);
  assert.match(em("2026-10-12T19:29:00.000Z"), /há 2\u00a0h\u00a05\u00a0min/);

  const parado = agendador(
    { ...ESTADO, agendadorAtivo: false, proximaBusca: null, emAndamento: [] },
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
  assert.match(html, /^<h2>loja <span class="muted contagem">1 issue<\/span><button [^>]*data-remover-projeto/);
  assert.match(html, /aria-label="Remover o projeto loja">Remover<\/button><\/h2>/);
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

test("effort por etapa: abaixo do modelo, seis seletores em padrão do pi, as oito opções, o gravado e o erro (CA-1, CA-2, CA-3, CA-8)", () => {
  const vazio = formularioDeProjeto({ ...LOJA, efforts: undefined }, { issues: 1, modelos: MODELOS, erros: new Map() });
  assert.match(
    vazio,
    /Modelo por etapa[\s\S]*<h3>Effort por etapa <span class="nota">· o raciocínio da IA \(pi --thinking\); vazio usa o padrão do pi<\/span><\/h3><div class="modelos-grade">/,
  );
  assert.equal(
    vazio.match(/<select id="campo-efforts\.\w+" name="efforts\.\w+" aria-label="Effort de [^"]+" class="padrao">/g)
      ?.length,
    6,
  );
  assert.match(vazio, /<label for="campo-efforts.sessao">Sessão em aberto<\/label>/);
  assert.match(vazio, /aria-label="Effort de Sessão em aberto"/);
  assert.match(
    vazio,
    /name="efforts.desenho" aria-label="Effort de Desenho" class="padrao"><option value="">padrão do pi<\/option><option value="off">off<\/option><option value="minimal">minimal<\/option><option value="low">low<\/option><option value="medium">medium<\/option><option value="high">high<\/option><option value="xhigh">xhigh<\/option><option value="max">max<\/option><\/select>/,
  );

  const gravado = formularioDeProjeto(
    { ...LOJA, efforts: { desenho: "high" } },
    { issues: 1, modelos: MODELOS, erros: errosDoZod("✖ Entrada inválida\n  → at efforts.desenho") },
  );
  assert.match(
    gravado,
    /<div class="celula erro"><select id="campo-efforts.desenho" name="efforts.desenho" aria-label="Effort de Desenho" aria-invalid="true" aria-describedby="campo-efforts.desenho-erro">.*<option value="high" selected>high<\/option>.*<\/select><span class="msg-erro" id="campo-efforts.desenho-erro">Entrada inválida<\/span>/,
  );
  assert.match(gravado, /name="efforts.revisao" aria-label="Effort de Revisão" class="padrao">/);
});

test("link do produto: no grupo Repositório depois do SonarQube, com a ajuda, o valor e o erro do campo", () => {
  const html = formularioDeProjeto(
    { ...LOJA, linkProduto: "https://demo.exemplo.com" },
    { issues: 1, modelos: MODELOS, erros: errosDoZod("✖ Informe um link http(s) válido\n  → at linkProduto") },
  );
  assert.match(
    html,
    /id="campo-sonar.projectKey".*<div class="campo largo erro"><label for="campo-linkProduto">Link do produto<\/label><input class="mono" id="campo-linkProduto" name="linkProduto" value="https:\/\/demo.exemplo.com" placeholder="https:\/\/produto.exemplo.com" aria-invalid="true" aria-describedby="campo-linkProduto-erro"><span class="msg-erro" id="campo-linkProduto-erro">Informe um link http\(s\) válido<\/span><span class="ajuda">opcional; endereço http\(s\) do produto no ar, de preferência homologação. Sem ele, a Simulação não executa<\/span>/,
  );
  assert.match(formularioDeProjeto(NOVO, { modelos: [], erros: new Map() }), /name="linkProduto" value=""/);
});

test("o bloco dos usuários simulados só existe no projeto salvo, depois do formulário", () => {
  assert.match(
    formularioDeProjeto(LOJA, { issues: 1, modelos: MODELOS, erros: new Map() }),
    /<\/form><section class="usuarios-simulados" data-usuarios-simulados [^>]*><\/section>$/,
  );
  assert.doesNotMatch(formularioDeProjeto(NOVO, { modelos: MODELOS, erros: new Map() }), /data-usuarios-simulados/);
});

const VAZIO = { rascunho: { nome: "", descricao: "" }, erros: new Map(), falhasDeAnexo: new Map<number, string>() };
const MARIA = {
  id: 7,
  projeto: "loja",
  nome: "Dona <Maria>",
  descricao: "Contadora de 60 anos",
  anexos: [
    { nome: "manual.pdf", sha256: "a".repeat(64), bytes: 248731 },
    { nome: "nota.txt", sha256: "b".repeat(64), bytes: 1 },
  ],
};

test("usuários simulados: o cartão tem nome, descrição, anexos com o tamanho e o ×, e o + anexar arquivo (CA-3, CA-5)", () => {
  const html = usuariosSimulados([MARIA], VAZIO);
  assert.match(html, /<article class="cartao-usuario" data-usuario="7"><h4>Dona &#60;Maria&#62;<\/h4>/);
  assert.match(html, /<p class="descricao-usuario">Contadora de 60 anos<\/p>/);
  assert.match(
    html,
    /<li class="anexo-usuario">manual.pdf <span class="muted">248.731 bytes<\/span><button type="button" class="x" data-remover-anexo="manual.pdf" [^>]*aria-label="Remover o anexo manual.pdf">×<\/button><\/li>/,
  );
  assert.match(html, /<li class="anexo-usuario">nota.txt <span class="muted">1 byte<\/span>/);
  assert.match(
    html,
    /<button type="button" class="link" data-anexar-botao>\+ anexar arquivo<\/button><input type="file" accept="\.pdf,[^"]*\.gif" data-anexar hidden/,
  );
  assert.doesNotMatch(usuariosSimulados([{ ...MARIA, anexos: [] }], VAZIO), /class="anexos-usuario"/);
});

test("usuários simulados: sem usuário, a nota; o formulário tem Nome e Descrição com o rascunho", () => {
  const html = usuariosSimulados([], { ...VAZIO, rascunho: { nome: 'Seu "João"', descricao: "Gerente" } });
  assert.match(html, /Nenhum usuário simulado neste projeto ainda\./);
  assert.doesNotMatch(html, /cartao-usuario/);
  assert.match(html, /<form class="form novo-usuario" data-usuario-simulado novalidate>/);
  assert.match(
    html,
    /<label for="campo-usuario-nome">Nome do usuário<\/label><input id="campo-usuario-nome" name="nome" value="Seu &#34;João&#34;"/,
  );
  assert.match(
    html,
    /<label for="campo-usuario-descricao">Descrição do usuário<\/label><textarea id="campo-usuario-descricao" name="descricao"[^>]*>Gerente<\/textarea>/,
  );
  assert.match(html, /<button type="submit" class="btn btn-primario">Criar usuário simulado<\/button>/);
});

test("usuários simulados: o erro de cada campo fica abaixo dele, a recusa do servidor abaixo do formulário e a do anexo no cartão (CA-4)", () => {
  const erros = errosDoZod("✖ Descrição obrigatória\n  → at descricao");
  const html = usuariosSimulados([MARIA], {
    ...VAZIO,
    erros,
    falha: "já existe o Usuário Simulado Seu João",
    falhasDeAnexo: new Map([[7, "formato não suportado: envie PDF, texto ou imagem"]]),
  });
  assert.match(
    html,
    /<textarea id="campo-usuario-descricao"[^>]*aria-invalid="true" aria-describedby="campo-usuario-descricao-erro"><\/textarea><span class="msg-erro" id="campo-usuario-descricao-erro">Descrição obrigatória<\/span>/,
  );
  assert.doesNotMatch(html, /campo-usuario-nome-erro/);
  assert.match(html, /<span class="msg-erro falha" role="alert">já existe o Usuário Simulado Seu João<\/span>/);
  assert.match(
    html,
    /<span class="msg-erro" role="alert">formato não suportado: envie PDF, texto ou imagem<\/span><\/article>/,
  );
});

test("o botão Remover só existe no projeto salvo", () => {
  assert.doesNotMatch(formularioDeProjeto(NOVO, { modelos: MODELOS, erros: new Map() }), /data-remover-projeto/);
});

test("confirmacaoDeRemover: o nome escapado, o plural das issues, Cancelar e Remover projeto", () => {
  const um = confirmacaoDeRemover("<demo>", 1);
  assert.match(um, /<h2 id="titulo-remover">Remover o projeto &#60;demo&#62;<\/h2>/);
  assert.match(um, /O projeto <strong>&#60;demo&#62;<\/strong> e 1 issue serão apagados/);
  assert.match(um, /<button class="btn">Cancelar<\/button>/);
  assert.match(um, /data-confirmar-remover>Remover projeto<\/button>/);
  assert.match(confirmacaoDeRemover("demo", 4), /e 4 issues serão apagados/);
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
