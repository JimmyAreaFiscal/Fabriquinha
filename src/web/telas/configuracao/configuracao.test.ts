import assert from "node:assert/strict";
import { test } from "node:test";
import type { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../../../contrato/configuracao.ts";
import {
  agendador,
  ambiente,
  confirmacaoDeEliminar,
  confirmacaoDeRemover,
  errosDoZod,
  formularioDeProjeto,
  menu,
  modeloDasAvaliacoes,
  NOVO,
  pagina,
  projetoInexistente,
  rascunhoDe,
  selecao,
  usuariosSimulados,
} from "./configuracao.ts";
import { descreverEtapasDoSdlc } from "../../../api/rotas/etapas.ts";
import { definirEtapasDoSdlc } from "../../apresentacao/etapas.ts";

definirEtapasDoSdlc(descreverEtapasDoSdlc());

// A hora da próxima busca sai no fuso do navegador; aqui, um fuso fixo.
process.env.TZ = "America/Sao_Paulo";

const LOJA: ProjetoCadastrado = {
  nome: "loja",
  raiz_git: "/code/loja",
  branch_base: "main",
  hospedagem: "github",
  etapas: [],
  verificacoes: { preparacao: ["npm ci"], fitness: [], linguagens: [], e2e: [], globs: [] },
  chave_sonarqube: "loja",
  configuracoes: {},
};

test("rascunhoDe mantém os campos editáveis e solta apenas a preparação das verificações", () => {
  const cadastrado = { ...LOJA, link_produto: "https://loja.exemplo.com" };
  assert.deepEqual(rascunhoDe(cadastrado), {
    nome: "loja",
    raiz_git: "/code/loja",
    branch_base: "main",
    hospedagem: "github",
    link_produto: "https://loja.exemplo.com",
    preparacao: ["npm ci"],
    configuracoes: {},
  });
  assert.equal(rascunhoDe(LOJA).link_produto, undefined);
});

const MODELOS = [
  { provedor: "anthropic", nome: "claude-opus-5-5" },
  { provedor: "anthropic", nome: "claude-sonnet-5-5" },
];

test("selecao: o item do menu pelo endereço", () => {
  assert.deepEqual(selecao(""), { tipo: "agendador" });
  assert.deepEqual(selecao("?projeto=loja%20x"), { tipo: "projeto", nome: "loja x" });
  assert.deepEqual(selecao("?projeto="), { tipo: "agendador" });
  assert.deepEqual(selecao("?novo"), { tipo: "novo" });
  assert.deepEqual(selecao("?avaliacoes"), { tipo: "avaliacoes" });
  assert.deepEqual(selecao("?ambiente"), { tipo: "ambiente" });
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
  assert.match(html, /<a href="\/config\?avaliacoes">Avaliações<\/a>/);
  assert.doesNotMatch(html, /Auditoria/);
  assert.match(
    menu(ligado, [], { tipo: "avaliacoes" }),
    /<a href="\/config\?avaliacoes" aria-current="page">Avaliações<\/a>/,
  );
  assert.doesNotMatch(menu(ligado, [], { tipo: "avaliacoes" }), /<a href="\/config" aria-current/);
  assert.match(html, /<a href="\/config\?ambiente">Ambiente<\/a>/);
  assert.match(
    menu(ligado, [], { tipo: "ambiente" }),
    /<a href="\/config\?ambiente" aria-current="page">Ambiente<\/a>/,
  );
  assert.match(menu(ligado, [], { tipo: "novo" }), /<a class="novo" href="\/config\?novo" aria-current="page">/);
});

const ESTADO: EstadoDaConfiguracao = {
  agendadorAtivo: true,
  intervaloMin: 5,
  timeoutMin: 120,
  ociosidadeMin: 30,
  modeloAuditoria: null,
  proximaBusca: "2026-10-12T17:35:00.000Z",
};

test("agendador: interruptor, os três tempos e a próxima busca no fuso local; sem painel de execuções autônomas (CA-13)", () => {
  const html = agendador(ESTADO, new Map());
  assert.match(html, /<input type="checkbox" name="agendadorAtivo" checked>/);
  assert.match(
    html,
    /<label for="campo-intervaloMin">Procurar a cada<\/label><span class="com-unidade"><input type="number" id="campo-intervaloMin" name="intervaloMin" value="5" min="1" max="1440"> min/,
  );
  assert.match(html, /name="timeoutMin" value="120" min="10"/);
  assert.match(html, /name="ociosidadeMin" value="30" min="5"/);
  assert.match(html, /<div class="status-ag"><span>Próxima busca às <b>14:35<\/b><\/span><\/div>/);
  assert.doesNotMatch(html, /Executando|execução autônoma|I-\d|T-\d/);

  const parado = agendador(
    { ...ESTADO, agendadorAtivo: false, proximaBusca: null },
    errosDoZod("✖ Pequeno demais: esperava que o número fosse >= 1\n  → at intervaloMin"),
  );
  assert.match(parado, /<input type="checkbox" name="agendadorAtivo">/);
  assert.match(parado, /Desligado: <b>não procura tickets<\/b>/);
  assert.match(
    parado,
    /<div class="num-campo erro">.*aria-invalid="true" aria-describedby="campo-intervaloMin-erro"> min<\/span><span class="msg-erro" id="campo-intervaloMin-erro">Pequeno demais: esperava que o número fosse &#62;= 1<\/span><\/div>/,
  );
});

test("avaliações: o seletor do modelo em padrão do pi, com o escolhido, com o gravado fora da lista e com o erro", () => {
  const sem = modeloDasAvaliacoes(ESTADO, MODELOS, new Map());
  assert.match(sem, /<h2>Avaliações<\/h2><form class="form" data-avaliacoes novalidate>/);
  assert.match(sem, /<label for="campo-modeloAuditoria">Modelo das avaliações<\/label>/);
  assert.match(sem, /vale para as avaliações iniciadas em Avaliações/);
  assert.match(
    sem,
    /<select id="campo-modeloAuditoria" name="modeloAuditoria" class="padrao"><option value="">padrão do pi<\/option><option value="anthropic\/claude-opus-5-5">/,
  );
  assert.match(sem, /<button type="submit" class="btn btn-primario">Salvar<\/button>/);

  const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
  const escolhido = modeloDasAvaliacoes({ ...ESTADO, modeloAuditoria: opus }, MODELOS, new Map());
  assert.match(escolhido, /<select id="campo-modeloAuditoria" name="modeloAuditoria"><option value="">/);
  assert.match(escolhido, /<option value="anthropic\/claude-opus-5-5" selected>/);

  const fora = modeloDasAvaliacoes(
    { ...ESTADO, modeloAuditoria: { provedor: "llamacpp", nome: "qwen" } },
    MODELOS,
    new Map(),
  );
  assert.match(fora, /<option value="llamacpp\/qwen" selected>llamacpp \/ qwen<\/option><\/select>/);

  const erro = modeloDasAvaliacoes(
    ESTADO,
    MODELOS,
    errosDoZod("✖ o modelo inexistente/xyz não existe no pi\n  → at modeloAuditoria"),
  );
  assert.match(erro, /aria-invalid="true" aria-describedby="campo-modeloAuditoria-erro"/);
  assert.match(
    erro,
    /<span class="msg-erro" id="campo-modeloAuditoria-erro">o modelo inexistente\/xyz não existe no pi/,
  );
});

test("projeto salvo: nome só leitura, hospedagem, preparação e etapas; sem testes, SonarQube e fitness (CA-13)", () => {
  const html = formularioDeProjeto(rascunhoDe(LOJA), { novo: false, modelosDoPi: MODELOS, erros: new Map() });
  assert.match(html, /^<h2>loja<button [^>]*data-remover-projeto/);
  assert.match(html, /aria-label="Remover o projeto loja">Remover<\/button><\/h2>/);
  assert.match(html, /<input id="campo-nome" name="nome" value="loja" readonly>/);
  assert.match(html, /<input id="campo-hospedagem" value="GitHub" readonly>/);
  assert.match(
    html,
    /<h3>Preparação<\/h3>.*<input class="mono" value="npm ci" placeholder="npm ci" aria-label="Preparação da worktree: comando 1">/,
  );
  assert.doesNotMatch(html, /[Tt]estes|SonarQube|sonar|[Ff]itness|[i]ssue/);
  assert.match(
    html,
    /<span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.<\/span><button/,
  );
  assert.match(html, /<button type="submit" class="btn btn-primario">Salvar projeto<\/button>/);
});

test("modelo e effort por etapa: uma linha por etapa com o seletor do pi e o de effort; padrão do pi apagado", () => {
  const html = formularioDeProjeto(
    {
      ...rascunhoDe(LOJA),
      configuracoes: {
        planejar: { modelo: MODELOS[0], effort: "high" },
        implementar: { modelo: { provedor: "llamacpp", nome: "qwen" } },
      },
    },
    { novo: false, modelosDoPi: MODELOS, erros: new Map() },
  );
  assert.match(
    html,
    /<h3>Modelo e effort por etapa <span class="nota">· o effort é o raciocínio da IA \(pi --thinking\); vazio usa o padrão do pi; o ticket pode sobrescrever<\/span><\/h3><div class="modelos-grade"><span class="modelos-cab" aria-hidden="true">Etapa<\/span><span class="modelos-cab" aria-hidden="true">Modelo<\/span><span class="modelos-cab" aria-hidden="true">Effort<\/span><label for="campo-configuracoes.entender_e_desenhar.modelo">Demanda<\/label>/,
  );
  assert.deepEqual(
    [...html.matchAll(/<label for="campo-configuracoes\.[a-z_]+\.modelo">([^<]+)<\/label>/g)].map((m) => m[1]),
    [
      "Demanda",
      "Planejar",
      "Implementar",
      "Revisar rodada",
      "Encerrar rodada",
      "Sessão em aberto",
      "Revisar demanda",
      "Encerrar demanda",
      "Resolver conflito",
    ],
  );
  assert.match(
    html,
    /<select id="campo-configuracoes.entender_e_desenhar.modelo" name="configuracoes.entender_e_desenhar.modelo" class="padrao"><option value="">padrão do pi<\/option><option value="anthropic\/claude-opus-5-5">anthropic \/ claude-opus-5-5<\/option>/,
  );
  assert.match(
    html,
    /<select id="campo-configuracoes.planejar.modelo" name="configuracoes.planejar.modelo"><option value="">padrão do pi<\/option><option value="anthropic\/claude-opus-5-5" selected>/,
  );
  // O gravado que o pi deixou de listar continua no seletor.
  assert.match(html, /<option value="llamacpp\/qwen" selected>llamacpp \/ qwen<\/option><\/select>/);
  assert.match(
    html,
    /<div class="celula celula-effort"><select id="campo-configuracoes.planejar.effort" name="configuracoes.planejar.effort" aria-label="Effort de Planejar"><option value="">padrão do pi<\/option><option value="off">off<\/option>.*<option value="high" selected>high<\/option>/,
  );
  assert.match(
    html,
    /<select id="campo-configuracoes.entender_e_desenhar.effort" name="configuracoes.entender_e_desenhar.effort" aria-label="Effort de Demanda" class="padrao">/,
  );

  const erro = formularioDeProjeto(rascunhoDe(LOJA), {
    novo: false,
    modelosDoPi: MODELOS,
    erros: errosDoZod(
      "✖ o modelo x/y não existe no pi\n  → at configuracoes.revisar_rodada.modelo\n✖ inválido\n  → at configuracoes.entender_e_desenhar.effort",
    ),
  });
  assert.match(
    erro,
    /<div class="celula erro"><select id="campo-configuracoes.revisar_rodada.modelo" name="configuracoes.revisar_rodada.modelo" class="padrao" aria-invalid="true" aria-describedby="campo-configuracoes.revisar_rodada.modelo-erro">.*<\/select><span class="msg-erro" id="campo-configuracoes.revisar_rodada.modelo-erro">o modelo x\/y não existe no pi<\/span><\/div>/,
  );
  assert.match(
    erro,
    /<div class="celula celula-effort erro"><select id="campo-configuracoes.entender_e_desenhar.effort" [^>]*aria-invalid="true"[^>]*>.*?<\/select><span class="msg-erro" id="campo-configuracoes.entender_e_desenhar.effort-erro">inválido<\/span>/,
  );
  assert.match(erro, /2 campos com erro/);
});

test("link do produto: no grupo Repositório ao lado da hospedagem, com a ajuda, o valor e o erro do campo", () => {
  const html = formularioDeProjeto(
    { ...rascunhoDe(LOJA), link_produto: "https://demo.exemplo.com" },
    { novo: false, modelosDoPi: MODELOS, erros: errosDoZod("✖ Informe um link http(s) válido\n  → at link_produto") },
  );
  assert.match(
    html,
    /id="campo-hospedagem".*<div class="campo erro"><label for="campo-link_produto">Link do produto<\/label><input class="mono" id="campo-link_produto" name="link_produto" value="https:\/\/demo.exemplo.com" placeholder="https:\/\/produto.exemplo.com" aria-invalid="true" aria-describedby="campo-link_produto-erro"><span class="msg-erro" id="campo-link_produto-erro">Informe um link http\(s\) válido<\/span><span class="ajuda">opcional; endereço http\(s\) do produto no ar, de preferência homologação. Sem ele, a Simulação não executa<\/span>/,
  );
  assert.match(
    formularioDeProjeto(NOVO, { novo: true, modelosDoPi: MODELOS, erros: new Map() }),
    /name="link_produto" value=""/,
  );
});

test("o bloco dos usuários simulados só existe no projeto salvo, depois do formulário", () => {
  assert.match(
    formularioDeProjeto(rascunhoDe(LOJA), { novo: false, modelosDoPi: MODELOS, erros: new Map() }),
    /<\/form><section class="usuarios-simulados" data-usuarios-simulados [^>]*><\/section>$/,
  );
  assert.doesNotMatch(
    formularioDeProjeto(NOVO, { novo: true, modelosDoPi: MODELOS, erros: new Map() }),
    /data-usuarios-simulados/,
  );
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
  assert.doesNotMatch(
    formularioDeProjeto(NOVO, { novo: true, modelosDoPi: MODELOS, erros: new Map() }),
    /data-remover-projeto/,
  );
});

test("formularioDeProjeto liga à configuração SDLC fora do h2, só no projeto salvo", () => {
  const salvo = formularioDeProjeto(rascunhoDe(LOJA), { novo: false, modelosDoPi: MODELOS, erros: new Map() });
  assert.match(
    salvo,
    /<\/h2><p class="link-sdlc"><a class="link" href="\/projects\/loja\/sdlc">Configuração SDLC do projeto<\/a>/,
  );
  assert.doesNotMatch(formularioDeProjeto(NOVO, { novo: true, modelosDoPi: MODELOS, erros: new Map() }), /sdlc/);
});

test("confirmacaoDeRemover: o nome escapado, o que sai junto, Cancelar e Remover projeto", () => {
  const html = confirmacaoDeRemover("<demo>");
  assert.match(html, /<h2 id="titulo-remover">Remover o projeto &#60;demo&#62;<\/h2>/);
  assert.match(html, /O projeto <strong>&#60;demo&#62;<\/strong> será apagado com as demandas, em qualquer estado,/);
  assert.match(html, /<button class="btn">Cancelar<\/button>/);
  assert.match(html, /data-confirmar-remover>Remover projeto<\/button>/);
});

test("novo projeto: o nome editável com a ajuda; os erros ao lado de cada campo e quantos no rodapé", () => {
  const erros = errosDoZod(
    [
      "✖ use letras minúsculas\n  → at nome",
      "✖ caminho absoluto\n  → at raiz_git",
      "✖ Pequeno demais\n  → at preparacao[0]",
    ].join("\n"),
  );
  const html = formularioDeProjeto({ ...NOVO, preparacao: [""] }, { novo: true, modelosDoPi: MODELOS, erros });
  assert.match(html, /^<h2>Novo projeto<\/h2>/);
  assert.match(
    html,
    /<div class="campo erro"><label for="campo-nome">Nome<\/label><input id="campo-nome" name="nome" value="" placeholder="loja-api" aria-invalid="true" aria-describedby="campo-nome-erro"><span class="msg-erro" id="campo-nome-erro">use letras minúsculas<\/span><span class="ajuda">letras minúsculas, números e hífen; não muda depois<\/span><\/div>/,
  );
  assert.match(html, /<div class="campo largo erro"><label for="campo-raiz_git">/);
  assert.match(html, /<input id="campo-hospedagem" value="deduzida do remoto ao salvar" readonly>/);
  assert.match(
    html,
    /<div class="item-lista erro"><input class="mono" value="" placeholder="npm ci" aria-label="Preparação da worktree: comando 1" aria-invalid="true" aria-describedby="campo-preparacao\[0\]-erro">/,
  );
  assert.match(
    html,
    /<span class="msg-erro">3 campos com erro<\/span><button type="button" class="btn" data-cancelar>Cancelar<\/button><button type="submit" class="btn btn-primario">Cadastrar projeto/,
  );
  assert.match(
    formularioDeProjeto(NOVO, {
      novo: true,
      modelosDoPi: MODELOS,
      erros: errosDoZod("✖ caminho absoluto\n  → at raiz_git"),
    }),
    /<span class="msg-erro">1 campo com erro<\/span>/,
  );
});

test("a falha que não é de campo (F5, C19) fica no rodapé, junto da nota e da contagem, que ficam", () => {
  const html = formularioDeProjeto(NOVO, {
    novo: true,
    modelosDoPi: MODELOS,
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

const AMBIENTE: EstadoDoAmbiente = {
  configuracao: { tipo: "container", memoria_maxima_mb: 1024, cpus: 1.5, ociosidade_para_eliminar_min: 30 },
  conjunto: [
    {
      id: "a-livre",
      container_id: "c1",
      imagem: "fabriquinha/loja:abc",
      estado: "livre",
      alocado_para: null,
      criado_em: "2026-11-09T10:00:00.000Z",
      liberado_em: "2026-11-09T11:30:00.000Z",
    },
    {
      id: "a-sujo",
      container_id: "c2",
      imagem: "alpine",
      estado: "sujo",
      alocado_para: null,
      criado_em: "2026-11-09T10:00:00.000Z",
      liberado_em: null,
    },
    {
      id: "a-<x>",
      container_id: "c3",
      imagem: "alpine",
      estado: "alocado",
      alocado_para: "I-1",
      criado_em: "2026-11-09T12:00:00.000Z",
      liberado_em: "2026-11-09T11:00:00.000Z",
    },
  ],
};

test("ambiente: tipo, limites e uma linha por container; Eliminar só ativo para livre e sujo", () => {
  const html = ambiente(AMBIENTE, new Map());
  assert.match(html, /<h2>Ambiente<\/h2><form class="form" data-ambiente novalidate>/);
  assert.match(html, /<option value="host_local">Host local<\/option><option value="container" selected>Container</);
  assert.match(html, /name="memoria_maxima_mb" value="1024" min="512" step="1"> MB/);
  assert.match(html, /name="cpus" value="1.5" min="0.1" step="any"> CPUs/);
  assert.match(html, /name="ociosidade_para_eliminar_min" value="30" min="5" step="1"> min/);
  assert.match(
    html,
    /<tr data-ambiente="a-livre"><td class="mono">a-livre<\/td><td class="mono">fabriquinha\/loja:abc<\/td><td>livre<\/td><td>—<\/td><td>09\/11\/2026,? 08:30<\/td><td><button type="button" class="btn btn-perigo" data-eliminar="a-livre" aria-label="Eliminar o container a-livre">Eliminar<\/button>/,
  );
  assert.match(
    html,
    /<tr data-ambiente="a-sujo">.*<td>sujo<\/td><td>—<\/td><td>09\/11\/2026,? 07:00<\/td><td><button[^>]*>Eliminar</,
  );
  assert.match(
    html,
    /<tr data-ambiente="a-&#60;x&#62;">.*<td>alocado<\/td><td>I-1<\/td><td>09\/11\/2026,? 09:00<\/td><td><button[^>]*aria-label="Eliminar o container a-&#60;x&#62;" disabled>Eliminar</,
  );
  assert.equal(html.match(/ disabled>/g)?.length, 1);
});

test("ambiente: conjunto vazio e o erro de um limite ao lado do campo", () => {
  const html = ambiente(
    { ...AMBIENTE, conjunto: [] },
    errosDoZod(
      "✖ Pequeno demais: esperava que o número fosse >= 512\n  → at memoria_maxima_mb\n✖ inválido\n  → at tipo",
    ),
  );
  assert.match(html, /<p class="muted">Nenhum container no conjunto.<\/p>/);
  assert.doesNotMatch(html, /<table/);
  assert.match(
    html,
    /aria-invalid="true" aria-describedby="campo-memoria_maxima_mb-erro"> MB<\/span><span class="msg-erro"/,
  );
  assert.match(html, /<select id="campo-tipo" name="tipo" aria-invalid="true" aria-describedby="campo-tipo-erro">/);
});

test("confirmação de eliminar: o id escapado e o botão que confirma", () => {
  const html = confirmacaoDeEliminar("a<b");
  assert.match(html, /<h2 id="titulo-eliminar">Eliminar o container a&#60;b<\/h2>/);
  assert.match(
    html,
    /<button type="button" class="btn btn-perigo-cheio" data-confirmar-eliminar>Eliminar container<\/button>/,
  );
});
