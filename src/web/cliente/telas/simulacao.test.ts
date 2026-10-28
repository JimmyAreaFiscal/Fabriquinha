import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecucaoSimulada, Tarefa, UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import { errosDoZod, type ProjetoListado } from "./configuracao.ts";
import {
  caminhoDaSimulacao,
  type DadosDaSimulacao,
  paginaDaSimulacao,
  listaDeTarefas,
  RASCUNHO_VAZIO,
  relatorioNaCaixa,
  SEM_PROJETOS_DA_SIMULACAO,
  temPendente,
} from "./simulacao.ts";

const projeto = (nome: string, linkProduto?: string): ProjetoListado => ({
  nome,
  repo: `/repos/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  sonar: { projectKey: nome },
  linkProduto,
});

const maria: UsuarioSimulado = { id: 1, projeto: "fabriquinha", nome: "Dona Maria", descricao: "d", anexos: [] };
const joao: UsuarioSimulado = { id: 2, projeto: "fabriquinha", nome: "Seu João", descricao: "d", anexos: [] };
const tarefa: Tarefa = {
  id: 7,
  projeto: "fabriquinha",
  texto: "Registrar uma <necessidade>",
  n: 3,
  criadaEm: "2026-10-13T10:00:00.000Z",
  usuarios: [
    { id: 1, nome: "Dona Maria" },
    { id: 2, nome: "Seu João" },
  ],
  execucoes: [],
};

const dados = (extra: Partial<DadosDaSimulacao> = {}): DadosDaSimulacao => ({
  projetos: [projeto("fabriquinha", "https://demo.exemplo.com"), projeto("loja api")],
  projeto: projeto("fabriquinha", "https://demo.exemplo.com"),
  usuarios: [maria, joao],
  tarefas: [],
  rascunho: RASCUNHO_VAZIO,
  erros: new Map(),
  ...extra,
});

test("o caminho da página codifica o nome do projeto e sem projeto a página convida a cadastrar um", () => {
  assert.equal(caminhoDaSimulacao("loja api"), "/simulation/loja%20api");
  assert.match(SEM_PROJETOS_DA_SIMULACAO, /<h1>Simulação<\/h1>.*href="\/config\?novo"/);
});

test("a página tem uma aba por projeto com a atual marcada e mostra o link do produto", () => {
  const html = paginaDaSimulacao(dados());
  assert.match(html, /<h1>Simulação<\/h1>/);
  assert.match(html, /<a href="\/simulation\/fabriquinha" aria-current="page">fabriquinha<\/a>/);
  assert.match(html, /<a href="\/simulation\/loja%20api">loja api<\/a>/);
  assert.match(html, /Produto em <span class="mono">https:\/\/demo\.exemplo\.com<\/span>/);
  assert.doesNotMatch(html, /sem link do produto/);
});

test("sem link do produto a página avisa", () => {
  const html = paginaDaSimulacao(dados({ projeto: projeto("fabriquinha") }));
  assert.match(html, /<span class="pill pill-aguarda sem-pulso">sem link do produto<\/span>/);
  assert.doesNotMatch(html, /Produto em/);
});

test("o formulário de nova Tarefa tem Tarefa, N e uma caixa por Usuário Simulado do projeto", () => {
  const html = paginaDaSimulacao(dados());
  assert.match(html, /<h2>Nova tarefa<\/h2>/);
  assert.match(html, /<label for="campo-tarefa-texto">Tarefa<\/label><textarea id="campo-tarefa-texto" name="texto"/);
  assert.match(
    html,
    /<label for="campo-tarefa-n">Execuções por usuário \(N\)<\/label><input type="number"[^>]* value="1"/,
  );
  assert.match(html, /<input type="checkbox" name="usuarios" value="1"> Dona Maria/);
  assert.match(html, /<input type="checkbox" name="usuarios" value="2"> Seu João/);
  assert.doesNotMatch(html, /msg-erro|aria-invalid|checked/);
});

test("sem Usuário Simulado o formulário manda cadastrar na Configuração do projeto", () => {
  const html = paginaDaSimulacao(dados({ usuarios: [], projeto: projeto("loja api") }));
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /<a class="link" href="\/config\?projeto=loja%20api">Configuração do projeto<\/a>/);
});

test("o rascunho volta nos campos, escapado, com as caixas marcadas", () => {
  const html = paginaDaSimulacao(dados({ rascunho: { texto: 'a "b" <c>', n: "0", usuarios: [2] } }));
  assert.match(html, />a &#34;b&#34; &#60;c&#62;<\/textarea>/);
  assert.match(html, / value="0"/);
  assert.match(html, /value="2" checked> Seu João/);
  assert.doesNotMatch(html, /value="1" checked/);
});

test("cada erro do 422 vai para o seu campo, ligado por aria-describedby (CA-8 e CA-9)", () => {
  const erros = errosDoZod(
    "✖ Tarefa obrigatória\n  → at texto\n✖ N deve ser um inteiro maior que zero\n  → at n\n✖ Aloque ao menos um usuário simulado\n  → at usuarios",
  );
  const html = paginaDaSimulacao(dados({ erros }));
  assert.match(html, /<span class="msg-erro" id="campo-tarefa-texto-erro">Tarefa obrigatória<\/span>/);
  assert.match(
    html,
    /<input type="number"[^>]*aria-invalid="true" aria-describedby="campo-tarefa-n-erro"[^>]*><span class="msg-erro" id="campo-tarefa-n-erro">N deve ser um inteiro maior que zero<\/span>/,
  );
  assert.match(
    html,
    /<fieldset class="campo alocar erro" aria-describedby="campo-tarefa-usuarios-erro">.*<span class="msg-erro" id="campo-tarefa-usuarios-erro">Aloque ao menos um usuário simulado<\/span><\/fieldset>/,
  );
});

test("a recusa que não é de um campo aparece como alerta abaixo do formulário", () => {
  const html = paginaDaSimulacao(dados({ falha: "o Usuário Simulado 9 não é do projeto <x>" }));
  assert.match(
    html,
    /<span class="msg-erro falha" role="alert">o Usuário Simulado 9 não é do projeto &#60;x&#62;<\/span><\/form>/,
  );
});

test("cada Tarefa vira um cartão com o texto, N e os alocados (CA-7); sem Tarefa a página diz", () => {
  assert.match(paginaDaSimulacao(dados()), /<p class="muted">Nenhuma tarefa neste projeto\.<\/p>/);
  const html = paginaDaSimulacao(dados({ tarefas: [tarefa] }));
  assert.doesNotMatch(html, /Nenhuma tarefa/);
  assert.match(html, /<article class="tarefa superficie" data-tarefa="7">/);
  assert.match(html, /<strong class="tarefa-texto">Registrar uma &#60;necessidade&#62;<\/strong>/);
  assert.match(html, /<span class="tag">N = 3<\/span>/);
  assert.match(html, /alocada a <b>Dona Maria<\/b>, <b>Seu João<\/b>/);
});

const execucao = (id: number, extra: Partial<ExecucaoSimulada> = {}): ExecucaoSimulada => ({
  id,
  usuario: 1,
  usuarioNome: "Dona Maria",
  status: "na_fila",
  ...extra,
});
const relatorio = { usabilidade: ["O botão <Enviar> é pequeno"], bugs: [] };
const comExecucoes = (...execucoes: ExecucaoSimulada[]): Tarefa => ({ ...tarefa, execucoes });

test("a Tarefa sem execução tem o botão Executar e diz que não há execução ainda", () => {
  const html = listaDeTarefas([tarefa]);
  assert.match(html, /<button type="button" class="btn btn-primario" data-executar="7">Executar<\/button>/);
  assert.match(html, /<p class="muted">Nenhuma execução ainda\.<\/p>/);
  assert.doesNotMatch(html, /<table|Executando|msg-erro/);
});

test("as execuções vão numa tabela com # , usuário e a pílula do status; só a concluída tem Ver relatório (CA-11)", () => {
  const html = listaDeTarefas([
    comExecucoes(
      execucao(10, { status: "concluida", relatorio }),
      execucao(11, { status: "em_andamento" }),
      execucao(12),
      execucao(13, {
        status: "falhou",
        usuario: 2,
        usuarioNome: "Seu <João>",
        erro: "Não foi possível abrir o link do produto",
      }),
    ),
  ]);
  assert.match(html, /<th>Usuário simulado<\/th><th>Status<\/th>/);
  assert.match(
    html,
    /<td class="id">#1<\/td><td>Dona Maria<\/td><td><span class="pill pill-ok">concluído<\/span><\/td><td><button type="button" class="link" data-relatorio="7:10">Ver relatório<\/button><\/td>/,
  );
  assert.match(html, /<td class="id">#2<\/td>.*<span class="pill pill-rodando">em andamento<\/span><\/td><td><\/td>/);
  assert.match(html, /<td class="id">#3<\/td>.*<span class="pill pill-neutro">na fila<\/span><\/td><td><\/td>/);
  assert.match(
    html,
    /<td class="id">#4<\/td><td>Seu &#60;João&#62;<\/td><td><span class="pill pill-falha">falhou<\/span><\/td><td><span class="msg-erro">Não foi possível abrir o link do produto<\/span><\/td>/,
  );
  assert.equal(html.match(/data-relatorio/g)?.length, 1);
});

test("com execução pendente o botão vira Executando… e fica desligado; terminadas, volta a Executar", () => {
  for (const status of ["na_fila", "em_andamento"] as const) {
    const html = listaDeTarefas([comExecucoes(execucao(1, { status }))]);
    assert.match(html, /data-executar="7" disabled>Executando…<\/button>/);
  }
  const html = listaDeTarefas([comExecucoes(execucao(1, { status: "falhou", erro: "x" }))]);
  assert.match(html, /data-executar="7">Executar<\/button>/);
});

test("temPendente vale com alguma execução na fila ou em andamento, em qualquer Tarefa", () => {
  assert.equal(temPendente([]), false);
  assert.equal(temPendente([tarefa, comExecucoes(execucao(1, { status: "concluida", relatorio }))]), false);
  assert.equal(temPendente([tarefa, comExecucoes(execucao(1, { status: "concluida", relatorio }), execucao(2))]), true);
  assert.equal(temPendente([comExecucoes(execucao(1, { status: "em_andamento" }))]), true);
});

test("a recusa do Executar aparece como alerta no cartão da Tarefa (CA-10), escapada", () => {
  const sem = { 7: "Informe o link do produto na Configuração <do projeto>" };
  const html = paginaDaSimulacao(dados({ tarefas: [tarefa], falhasDeExecutar: sem }));
  assert.match(
    html,
    /<p class="msg-erro falha" role="alert">Informe o link do produto na Configuração &#60;do projeto&#62;<\/p>/,
  );
  assert.doesNotMatch(listaDeTarefas([tarefa], { 8: "x" }), /role="alert"/);
  assert.match(html, /data-tarefas>/);
});

test("o relatório na caixa tem as seções Usabilidade e Bugs, e Nenhum achado na vazia (CA-13)", () => {
  const e = execucao(11, { status: "concluida", relatorio });
  const caixa = relatorioNaCaixa(comExecucoes(execucao(10), e), { ...e, relatorio });
  assert.equal(caixa.titulo, "Relatório · Dona Maria · execução #2");
  assert.equal(caixa.meta, "Registrar uma <necessidade>");
  assert.match(caixa.corpo, /<h3>Usabilidade<\/h3><ul><li>O botão &#60;Enviar&#62; é pequeno<\/li><\/ul>/);
  assert.match(caixa.corpo, /<h3>Bugs<\/h3><p class="muted">Nenhum achado<\/p>/);
  assert.doesNotMatch(caixa.corpo, /<h3>Usabilidade<\/h3><p/);
});
