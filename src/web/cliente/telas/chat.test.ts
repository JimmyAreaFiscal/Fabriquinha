import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { ExecucaoSessao } from "../../../dominio/sessoes.ts";
import type { Entrada } from "../../rotas/chat.ts";
import {
  barraDeEstado,
  type Cabecalho,
  chaveDa,
  comCursor,
  comResultado,
  corpoDaFerramenta,
  doSistema,
  conversa,
  emFluxo,
  type Envio,
  envio,
  erroDaFalha,
  etiquetaDoEstado,
  ferramenta,
  linhaDoDialogo,
  linhasDaExecucao,
  mensagem,
  modeloDaConversa,
  modeloDe,
  respostaDoDialogo,
  valorDoSelect,
} from "./chat.ts";

const T0 = "2026-10-11T10:00:00.000Z";

const execucao = (e: Partial<ExecucaoSessao> = {}): ExecucaoSessao => ({
  id: "abcdef12-0000-4000-8000-000000000001",
  sessao_id: "s",
  inicio: T0,
  falha: false,
  ...e,
});

type Sessao = Cabecalho["sessao"];

/** A sessão do ticket I-239.T1 (planejar), rodando, com uma execução aberta. */
const cabecalho = (sessao: Partial<Sessao> = {}, extra: Partial<Cabecalho> = {}): Cabecalho => ({
  origem: "demanda",
  sessao: {
    sessao: "s/1",
    projeto: "loja",
    modo: "interativo",
    execucao: "abcdef12-0000-4000-8000-000000000001",
    estado: "rodando",
    desde: T0,
    dialogos: [],
    ...sessao,
  },
  demanda: "I-239",
  ticket: "I-239.T1",
  etapa: "planejar",
  execucoes: [execucao()],
  ...extra,
});

const dialogo = (d: Record<string, unknown>): Dialogo => ({ type: "extension_ui_request", id: "d1", em: T0, ...d });

test("etiqueta do estado: rodando, aguardando com o motivo (falha em vermelho) e terminada", () => {
  const s = cabecalho().sessao;
  assert.equal(etiquetaDoEstado(s), '<span class="pill pill-rodando">rodando</span>');
  assert.equal(etiquetaDoEstado({ ...s, estado: "terminada" }), '<span class="pill pill-neutro">terminada</span>');
  const aguarda = { ...s, estado: "aguardando_humano" as const };
  assert.equal(
    etiquetaDoEstado({ ...aguarda, motivo: "gate_demanda" }),
    '<span class="pill pill-aguarda">aguarda você · gate da demanda</span>',
  );
  assert.equal(
    etiquetaDoEstado({ ...aguarda, motivo: "falha" }),
    '<span class="pill pill-falha">aguarda você · falha</span>',
  );
  assert.equal(etiquetaDoEstado(aguarda), '<span class="pill pill-aguarda">aguarda você · </span>');
});

test("modelo: o fixado na sessão, senão o da última resposta do agente, senão o padrão do pi", () => {
  const resposta = (model?: string): Entrada => ({
    type: "message",
    message: { role: "assistant", provider: "anthropic", ...(model && { model }) },
  });
  assert.equal(
    modeloDe(cabecalho({ modelo: { provedor: "llamacpp", modelo: "qwen" } }), [resposta("opus")]),
    "llamacpp / qwen",
  );
  assert.equal(modeloDe(cabecalho(), [resposta("sonnet"), resposta("opus"), { type: "session" }]), "anthropic / opus");
  assert.equal(modeloDe(cabecalho(), [resposta()]), "modelo padrão do pi");
  assert.equal(modeloDe(cabecalho(), []), "modelo padrão do pi");
  // A mesma leitura serve à avaliação, que não tem cabeçalho de sessão.
  assert.equal(modeloDaConversa([{ type: "message", message: { role: "user" } }]), "modelo padrão do pi");
  assert.equal(
    modeloDaConversa([resposta("sonnet"), resposta("opus"), { type: "message", message: { role: "toolResult" } }]),
    "anthropic / opus",
  );
});

test("barra de estado: demanda, rodada, ticket, etapa, modo, estado, modelo, execução e Exportar, sem log nem prompt", () => {
  const html = barraDeEstado(
    cabecalho({ estado: "aguardando_humano", motivo: "conversa" }, { rodada: "I-239.R1" }),
    "anthropic / <opus>",
  );
  assert.match(html, /<a class="issue" href="\/demandas\/I-239"><span class="id">I-239<\/span><\/a>/);
  assert.match(html, /<span class="id">I-239.R1<\/span><span class="sep">│<\/span><span class="id">I-239.T1<\/span>/);
  assert.match(html, /Planejamento · interativa<\/span><span class="pill pill-aguarda">aguarda você · conversa/);
  assert.match(html, /<span class="modelo" title="anthropic \/ &#60;opus&#62;">anthropic \/ &#60;opus&#62;<\/span>/);
  assert.match(html, /E-abcdef12<\/span><a class="link" href="\/api\/sessoes\/s%2F1\/historico.md" download>Exportar/);
  assert.doesNotMatch(html, /log|prompt|Conversar sobre/);
  assert.doesNotMatch(barraDeEstado(cabecalho(), "m"), /I-239.R1/);
});

test("linhas da execução: o início e, terminada, o fim ou a falha, sem link de log nem de prompt", () => {
  const aberta = linhasDaExecucao(execucao());
  assert.deepEqual(aberta, [
    { chave: "inicio-E-abcdef12", em: T0, html: '<div class="sistema">Execução E-abcdef12 iniciada</div>' },
  ]);
  const fim = "2026-10-11T10:05:00.000Z";
  assert.deepEqual(linhasDaExecucao(execucao({ fim }))[1], {
    chave: "fim-E-abcdef12",
    em: fim,
    html: '<div class="sistema">Execução E-abcdef12 encerrada</div>',
  });
  assert.equal(
    linhasDaExecucao(execucao({ fim, falha: true, erro: "<pi> caiu" }))[1]?.html,
    '<div class="sistema">Execução E-abcdef12 falhou: &#60;pi&#62; caiu</div>',
  );
});

test("linha do diálogo aberto pelo agente", () => {
  assert.deepEqual(linhaDoDialogo(dialogo({ title: "Qual `<ordem>`?" })), {
    chave: "dialogo-d1",
    html: '<div class="sistema">o agente abriu um diálogo: Qual <code>&lt;ordem&gt;</code>?</div>',
  });
});

test("ferramenta: argumentos em uma linha, resumo do resultado e a saída com ver tudo quando é longa", () => {
  const bash = { id: "t1", name: "bash", arguments: { command: "npm test" } };
  assert.equal(
    corpoDaFerramenta(bash),
    '<summary><span class="nome-f">bash</span><span class="args">npm test</span><span class="res neutro">sem resultado ainda</span></summary>',
  );
  assert.equal(ferramenta(bash), `<details class="ferramenta" data-chamada="t1">${corpoDaFerramenta(bash)}</details>`);
  const longa = Array.from({ length: 11 }, (_, i) => `<l${String(i)}>`).join("\n");
  const falhou = corpoDaFerramenta(bash, {
    role: "toolResult",
    isError: true,
    content: [{ type: "text", text: longa }],
  });
  assert.match(falhou, /<span class="res nok">✗ 11 linhas<\/span>/);
  assert.match(falhou, /<pre>&#60;l0&#62;\n/);
  assert.match(falhou, /<button type="button" class="link ver" data-ver-tudo>ver tudo<\/button>$/);
  const read = { id: "t2", name: "read", arguments: { path: "src/a.ts" } };
  assert.match(
    corpoDaFerramenta(read, { role: "toolResult", content: "uma" }),
    /<span class="args">src\/a.ts<\/span><span class="res ok">✓ 1 linha<\/span><\/summary><pre>uma<\/pre>$/,
  );
  assert.match(corpoDaFerramenta(read, { role: "toolResult", content: "a\nb" }), /✓ 2 linhas/);
  const vazia = corpoDaFerramenta(
    { id: "t3", name: "edit", arguments: { trocas: 2 } },
    { role: "toolResult", content: [] },
  );
  assert.match(
    vazia,
    /<span class="args">\{&#34;trocas&#34;:2\}<\/span><span class="res ok">✓ sem saída<\/span><\/summary>$/,
  );
  assert.match(corpoDaFerramenta({ id: "t4", name: "ls" }), /<span class="args">\{\}<\/span>/);
});

test("linha do sistema: o HTML vai em metadata.custom.html e o id é a chave", () => {
  assert.deepEqual(doSistema({ chave: "inicio-E-7", html: '<div class="sistema">x</div>' }), {
    id: "inicio-E-7",
    role: "system",
    content: [{ type: "text", text: "" }],
    metadata: { custom: { html: '<div class="sistema">x</div>' } },
  });
});

test("mensagem: a do Auditor e a do agente com raciocínio, texto e chamadas na ordem, e a parada como linha do sistema", () => {
  assert.deepEqual(mensagem({ role: "user", content: "<b>oi</b> **já**", timestamp: 4 }), [
    { id: "user-4", role: "user", content: [{ type: "text", text: "<b>oi</b> **já**" }] },
  ]);
  const bash = { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } };
  const resultado = { role: "toolResult", content: "ok" };
  const [agente, parou] = mensagem(
    {
      role: "assistant",
      timestamp: 5,
      content: [
        { type: "thinking", thinking: "penso <x>" },
        { type: "text", text: "Vou [rodar](javascript:alert(1))" },
        { type: "text", text: "  " },
        bash,
        { type: "image" },
      ],
      stopReason: "error",
      errorMessage: "sem <crédito>",
    },
    new Map([["t1", resultado]]),
  );
  assert.deepEqual(agente, {
    id: "assistant-5",
    role: "assistant",
    content: [
      { type: "reasoning", text: "penso <x>" },
      { type: "text", text: "Vou [rodar](javascript:alert(1))" },
      { type: "tool-call", toolCallId: "t1", toolName: "bash", artifact: { chamada: bash, resultado } },
    ],
  });
  assert.deepEqual(
    parou,
    doSistema({
      chave: "assistant-5-parou",
      html: '<div class="sistema">o agente parou com erro: sem &#60;crédito&#62;</div>',
    }),
  );
  assert.deepEqual(mensagem({ role: "assistant", content: [], stopReason: "aborted", timestamp: 6 }), [
    doSistema({ chave: "assistant-6-parou", html: '<div class="sistema">o agente foi interrompido</div>' }),
  ]);
  assert.deepEqual(mensagem({ role: "assistant" }), []);
  assert.deepEqual(mensagem({ role: "toolResult", content: "x" }), [], "o resultado completa a chamada");
});

interface ParteDeTeste {
  type: string;
  artifact?: { resultado?: unknown };
}
const partesDe = (m?: ThreadMessageLike) => m?.content as readonly ParteDeTeste[];

test("comResultado: completa só a chamada do id; o resto da conversa fica como está", () => {
  const chamada = { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } };
  const [agente = assert.fail("sem mensagem")] = mensagem({
    role: "assistant",
    timestamp: 1,
    content: [{ type: "text", text: "oi" }, chamada, { type: "toolCall", id: "t2", name: "ls" }],
  });
  const resultado = { role: "toolResult", toolCallId: "t1", content: "a" };
  const partes = partesDe(comResultado(agente, resultado));
  assert.equal(partes[0]?.type, "text");
  assert.deepEqual(partes[1]?.artifact, { chamada, resultado });
  assert.equal(partes[2]?.artifact?.resultado, undefined);
  const sistema = doSistema({ chave: "k", html: "" });
  assert.deepEqual(comResultado(sistema, resultado), sistema);
  const texto: ThreadMessageLike = { role: "user", content: "só texto" };
  assert.equal(comResultado(texto, resultado), texto);
});

test("conversa: mensagens e linhas das execuções por instante, sem o prompt da Fabriquinha, e os diálogos no fim", () => {
  const c = cabecalho(
    { dialogos: [dialogo({ title: "Seguir?" })] },
    { execucoes: [execucao({ inicio: "2026-10-11T10:00:00.000Z", fim: "2026-10-11T10:09:00.000Z" })] },
  );
  const entrada = (em: string, message: Record<string, unknown>, fabriquinha = false): Entrada => ({
    type: "message",
    timestamp: em,
    message,
    ...(fabriquinha && { fabriquinha: true }),
  });
  const itens = conversa(c, [
    { type: "session", id: "s" },
    entrada("2026-10-11T10:01:00.000Z", { role: "user", content: "# Contexto", timestamp: 1 }, true),
    entrada("2026-10-11T10:02:00.000Z", {
      role: "assistant",
      timestamp: 2,
      content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }],
    }),
    entrada("2026-10-11T10:03:00.000Z", { role: "toolResult", toolCallId: "t1", content: "a", timestamp: 3 }),
    entrada("2026-10-11T10:04:00.000Z", { role: "user", content: "oi", timestamp: 4 }),
  ]);
  assert.deepEqual(
    itens.map((i) => i.id),
    ["inicio-E-abcdef12", "assistant-2", "user-4", "fim-E-abcdef12", "dialogo-d1"],
  );
  const [, agente] = itens;
  assert.deepEqual(partesDe(agente)[0]?.artifact?.resultado, {
    role: "toolResult",
    toolCallId: "t1",
    content: "a",
    timestamp: 3,
  });
  assert.equal(chaveDa({ role: "assistant", timestamp: 9 }), "assistant-9");
});

test("em fluxo: o id é fluxo, o raciocínio só quando há; o cursor no fim do último parágrafo, ou depois do bloco", () => {
  assert.deepEqual(emFluxo("Os **testes**", ""), {
    id: "fluxo",
    role: "assistant",
    content: [{ type: "text", text: "Os **testes**" }],
  });
  assert.deepEqual(emFluxo("", "pensando").content, [
    { type: "reasoning", text: "pensando" },
    { type: "text", text: "" },
  ]);
  assert.equal(
    comCursor("<p>Os <strong>testes</strong></p>\n"),
    '<p>Os <strong>testes</strong><span class="cursor"></span></p>',
  );
  assert.equal(comCursor("<ul>\n<li>item</li>\n</ul>\n"), '<ul>\n<li>item</li>\n</ul>\n<span class="cursor"></span>');
  assert.equal(comCursor(""), '<span class="cursor"></span>');
});

/** O envio que é HTML pronto (diálogo, retomada, avisos), sem compositor. */
const htmlDe = (e: Envio): string => {
  assert.ok("html" in e);
  return e.html;
};
/** O envio que é o compositor do assistant-ui: o placeholder e a linha de botões. */
const compositorDe = (e: Envio) => {
  assert.ok("linha" in e);
  return e;
};

test("envio rodando: redirecionar ou enfileirar, abortar e enviar", () => {
  const { placeholder, linha } = compositorDe(envio(cabecalho(), "follow_up"));
  assert.equal(placeholder, "Mensagem para o agente enquanto ele trabalha");
  assert.match(linha, /data-modo="steer" aria-pressed="false"[^>]*>Redirecionar<\/button>/);
  assert.match(linha, /data-modo="follow_up" aria-pressed="true"[^>]*>Enfileirar<\/button>/);
  assert.match(linha, /Enter envia · Shift\+Enter quebra linha/);
  assert.match(linha, /data-abortar>Abortar<\/button><button class="btn btn-primario">Enviar<\/button>/);
  assert.doesNotMatch(linha, /Anexar|Concluir/);
});

test("envio em conversa: só enviar, sem anexar histórico nem concluir", () => {
  const conversa = compositorDe(envio(cabecalho({ estado: "aguardando_humano", motivo: "conversa" }), "steer"));
  assert.equal(conversa.placeholder, "Responda ao agente");
  assert.match(
    conversa.linha,
    /^<span class="dica-tecla">Enter envia · Shift\+Enter quebra linha<\/span><div class="direita"><button class="btn btn-primario">Enviar<\/button><\/div>$/,
  );
});

test("envio em diálogo: o formulário do método, com Cancelar e Responder", () => {
  const com = (d: Record<string, unknown>) =>
    htmlDe(envio(cabecalho({ estado: "aguardando_humano", motivo: "dialogo", dialogos: [dialogo(d)] }), "steer"));
  const select = com({ method: "select", title: "Qual `<ordem>`?", options: ["A <1>", "B"] });
  assert.match(
    select,
    /^<form class="dialogo-ext" data-dialogo="d1" data-metodo="select"><span class="rotulo">O agente pergunta<\/span><div>Qual <code>&lt;ordem&gt;<\/code>\?<\/div>/,
  );
  // Extensão: itens numerados e clicáveis, nada pré-marcado, sem «Outros» nem Responder.
  assert.match(
    select,
    /<div class="opcoes" role="group" aria-label="Opções"><button type="button" class="opcao" data-opcao="A &#60;1&#62;"><span class="opcao-rotulo">1\. A &#60;1&#62;<\/span><\/button><button type="button" class="opcao" data-opcao="B"><span class="opcao-rotulo">2\. B<\/span><\/button><\/div>/,
  );
  assert.doesNotMatch(select, /checked|data-outros|Responder|data-multipla/);
  assert.match(select, /data-cancelar>Cancelar<\/button><\/div><\/form>$/);
  assert.match(com({ method: "select", title: "t" }), /<div class="opcoes" role="group" aria-label="Opções"><\/div>/);
  // Pergunta da `perguntar`, escolha única: descrição embaixo, «Outros» no fim, campo oculto e Responder escondido.
  const unica = com({
    method: "select",
    title: "t",
    options: ["A", "B"],
    pergunta: true,
    descricoes: ["porque <sim>", undefined],
  });
  assert.match(unica, /<span class="opcao-descricao">porque &#60;sim&#62;<\/span><\/button>/);
  assert.equal(unica.match(/opcao-descricao/g)?.length, 1);
  assert.match(
    unica,
    /<button type="button" class="opcao" data-outros><span class="opcao-rotulo">Outros<\/span><\/button><\/div><textarea name="outro" rows="3" aria-label="Outros" required hidden disabled><\/textarea>/,
  );
  assert.match(
    unica,
    /data-cancelar>Cancelar<\/button><button class="btn btn-primario" hidden data-responder-outros>Responder<\/button>/,
  );
  // Múltipla: caixas, «Outros» também caixa, Responder sempre à mostra.
  const multipla = com({ method: "select", title: "t", options: ["A", "B"], pergunta: true, multiSelect: true });
  assert.match(multipla, /data-metodo="select" data-multipla>/);
  assert.match(
    multipla,
    /<label class="opcao"><input type="checkbox" name="opcao" value="A"><span><span class="opcao-rotulo">1\. A<\/span><\/span><\/label>/,
  );
  assert.match(
    multipla,
    /<label class="opcao"><input type="checkbox" data-outros><span class="opcao-rotulo">Outros<\/span><\/label>/,
  );
  assert.match(multipla, /<textarea name="outro"[^>]* required hidden disabled>/);
  assert.match(
    multipla,
    /data-cancelar>Cancelar<\/button><button class="btn btn-primario">Responder<\/button><\/div><\/form>$/,
  );
  const confirm = com({ method: "confirm", title: "Apagar?", message: "Fica <lento>.\n\n- roda `npm ci`" });
  assert.match(
    confirm,
    /<div class="muted md"><p>Fica &lt;lento&gt;.<\/p>\n<ul>\n<li>roda <code>npm ci<\/code><\/li>\n<\/ul>\n<\/div>/,
  );
  assert.match(confirm, /value="sim" checked> Sim<\/label><label><input type="radio" name="valor" value="nao"> Não/);
  assert.match(
    com({ method: "input", title: "t", placeholder: "em <s>" }),
    /<input name="valor" aria-label="Resposta" placeholder="em &#60;s&#62;" autocomplete="off">/,
  );
  assert.match(com({ method: "input", title: "t" }), /placeholder=""/);
  assert.match(
    com({ method: "editor", title: "t", prefill: "l1\nl2" }),
    /<textarea name="valor" rows="6" aria-label="Resposta">l1\nl2<\/textarea>/,
  );
  assert.match(com({ method: "editor", title: "t" }), /aria-label="Resposta"><\/textarea>/);
  // Só os 4 métodos chegam (P1 §2.1); outro não vira "undefined" nem um Responder que não sabe o que mandar.
  const outro = com({ method: "notify", title: "t" });
  assert.doesNotMatch(outro, /undefined|Responder/);
  assert.match(
    outro,
    /<p class="muted">A Fabriquinha não sabe responder a este pedido \(notify\); cancele para o agente seguir.<\/p><div class="botoes"><button type="button" class="btn" data-cancelar>Cancelar<\/button><\/div><\/form>$/,
  );
  assert.deepEqual(respostaDoDialogo("confirm", "sim"), { confirmado: true });
  assert.deepEqual(respostaDoDialogo("confirm", "nao"), { confirmado: false });
  assert.deepEqual(respostaDoDialogo("editor", "x"), { valor: "x" });
});

test("valorDoSelect: o texto de «Outros» na única, o JSON da lista na múltipla, nada sem escolha", () => {
  assert.equal(valorDoSelect(false, [], "  por data  "), "por data");
  assert.equal(valorDoSelect(false, [], "  "), undefined);
  assert.equal(valorDoSelect(true, ["A", "B"], ""), '["A","B"]');
  assert.equal(valorDoSelect(true, ["A"], " e mais "), '["A","e mais"]');
  assert.equal(valorDoSelect(true, [], "só outro"), '["só outro"]');
  assert.equal(valorDoSelect(true, [], " "), undefined);
});

test("envio na falha e no gate: o caminho para a página da demanda; terminada: Exportar histórico", () => {
  const aviso = (sessao: Partial<Sessao>) =>
    htmlDe(envio(cabecalho({ estado: "aguardando_humano", ...sessao }), "steer"));
  assert.equal(
    aviso({ motivo: "falha" }),
    '<div class="fim">O ticket falhou; reabra-o na página da demanda, com a instrução para a próxima tentativa.<div class="botoes"><a class="btn btn-primario" href="/demandas/I-239">Abrir a demanda</a></div></div>',
  );
  assert.match(
    aviso({ motivo: "gate_demanda" }),
    /O plano espera a sua aprovação; decida na página da demanda.*href="\/demandas\/I-239"/,
  );
  assert.equal(
    aviso({ estado: "terminada", sessao: "a b" }),
    '<div class="fim">Sessão terminada; a conversa fica só para leitura.<div class="botoes"><a class="btn" href="/api/sessoes/a%20b/historico.md" download>Exportar histórico</a></div></div>',
  );
});

test("erro da falha: a última execução, o motivo do ticket escapado e o que ficou; nada fora da falha", () => {
  const falha = cabecalho(
    { estado: "aguardando_humano", motivo: "falha" },
    { erro: "tempo limite de 30 min <atingido>." },
  );
  assert.deepEqual(erroDaFalha(falha), [
    {
      chave: "falha-E-abcdef12",
      html: '<div class="erro-bloco" role="alert"><strong>Execução E-abcdef12 falhou:</strong> tempo limite de 30 min &#60;atingido&#62;. O ticket I-239.T1 ficou <strong>falhou</strong>; o trabalho na worktree foi mantido.</div>',
    },
  ]);
  assert.deepEqual(erroDaFalha(cabecalho()), []);
  const itens = conversa({ ...falha, sessao: { ...falha.sessao, dialogos: [dialogo({ title: "t" })] } }, []);
  assert.deepEqual(
    itens.map((i) => i.id),
    ["inicio-E-abcdef12", "falha-E-abcdef12", "dialogo-d1"],
  );
});
