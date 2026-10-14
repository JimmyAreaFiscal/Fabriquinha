import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Evidencia, Execucao, Ticket } from "../../../dominio/agregado.ts";
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { CabecalhoDoChat, Entrada } from "../../rotas/chat.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import {
  barraDeEstado,
  chaveDa,
  comCursor,
  comResultado,
  contextoDaIssue,
  corpoDaFerramenta,
  doSistema,
  conversa,
  edicaoDoRegistro,
  emFluxo,
  type Envio,
  envio,
  erroDaFalha,
  etiquetaDoEstado,
  etiquetasDeAnexo,
  ferramenta,
  lateral,
  linhaDoDialogo,
  linhasDaExecucao,
  mensagem,
  modeloDe,
  respostaDoDialogo,
  seletorDeSessoes,
} from "./chat.ts";

const T0 = "2026-10-11T10:00:00.000Z";

const execucao = (e: Partial<Execucao> = {}): Execucao => ({
  id: 7,
  ticket: 3,
  modo: "autonomo",
  sessaoPi: "00000000-0000-4000-8000-000000000001",
  resultado: "em_andamento",
  iniciadaEm: T0,
  ...e,
});

type Sessao = CabecalhoDoChat["sessao"];

const ticket = (t: Partial<Ticket> = {}): Ticket => ({
  id: 3,
  issue: 4,
  etapa: "desenvolvimento",
  titulo: "Buscar <cupons>",
  descricao: "",
  status: "em_execucao",
  origem: "fabriquinha",
  criadoEm: T0,
  ...t,
});

const cabecalho = (sessao: Partial<Sessao> = {}, extra: Partial<CabecalhoDoChat> = {}): CabecalhoDoChat => ({
  sessao: {
    sessao: "s",
    issue: 4,
    projeto: "loja api",
    ticket: 3,
    etapa: "desenvolvimento",
    modo: "autonomo",
    execucao: 7,
    estado: "rodando",
    desde: T0,
    dialogos: [],
    ...sessao,
  },
  issue: {
    id: 4,
    projeto: "loja api",
    titulo: "Timeout <no> checkout",
    tipo: "problema",
    descricao: "",
    fase: "desenvolvimento",
    deps: [],
    criadaEm: T0,
  },
  ticket: ticket(),
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
    etiquetaDoEstado({ ...aguarda, motivo: "gate_registro" }),
    '<span class="pill pill-aguarda">aguarda você · gate do registro</span>',
  );
  assert.equal(
    etiquetaDoEstado({ ...aguarda, motivo: "falha" }),
    '<span class="pill pill-falha">aguarda você · falha</span>',
  );
  assert.equal(etiquetaDoEstado(aguarda), '<span class="pill pill-aguarda">aguarda você · </span>');
});

test("modelo: o da execução, senão o da última resposta do agente, senão o padrão do pi", () => {
  const resposta = (model?: string): Entrada => ({
    type: "message",
    message: { role: "assistant", provider: "anthropic", ...(model && { model }) },
  });
  const fixado = cabecalho({}, { execucoes: [execucao({ modelo: { provedor: "llamacpp", modelo: "qwen" } })] });
  assert.equal(modeloDe(fixado, [resposta("opus")]), "llamacpp / qwen");
  assert.equal(modeloDe(cabecalho(), [resposta("sonnet"), resposta("opus"), { type: "session" }]), "anthropic / opus");
  assert.equal(modeloDe(cabecalho(), [resposta()]), "modelo padrão do pi");
  assert.equal(modeloDe(cabecalho({}, { execucoes: [] }), []), "modelo padrão do pi");
});

test("barra de estado: issue com link e título escapado, ticket, etapa e modo, estado, modelo, log e prompt", () => {
  const html = barraDeEstado(cabecalho({ etapa: "sessao", modo: "interativo" }), "anthropic / <opus>");
  assert.match(
    html,
    /<a class="issue" href="\/projects\/loja%20api\/issues\/I-4"><span class="id">I-4<\/span> Timeout &#60;no&#62; checkout<\/a>/,
  );
  assert.match(
    html,
    /<span class="id">T-3<\/span><span class="muted">sessão em aberto · interativa<\/span><span class="pill pill-rodando">/,
  );
  assert.match(html, /<span class="modelo" title="anthropic \/ &#60;opus&#62;">anthropic \/ &#60;opus&#62;<\/span>/);
  assert.match(
    html,
    /E-7<\/span><a class="link" href="\/api\/execucoes\/7\/log" target="_blank" rel="noopener">log<\/a>/,
  );
  assert.match(
    html,
    /prompt<\/a><a class="link" href="\/api\/sessoes\/s\/historico.md" download>Exportar<\/a><button type="button" class="link" data-consulta>Conversar sobre<\/button><\/div><\/div>$/,
  );
  const semTitulo = cabecalho({ etapa: "registro", modo: "consulta" });
  assert.match(
    barraDeEstado({ ...semTitulo, issue: { ...semTitulo.issue, titulo: null } }, "m"),
    /I-4<\/span> sem título.*registro · consulta/,
  );
});

test("linhas da execução: início com o prompt e o fim conforme o resultado e o modo", () => {
  const [inicio, fim] = linhasDaExecucao(
    execucao({ resultado: "sucesso", terminadaEm: "2026-10-11T10:05:00.000Z" }),
    2,
  );
  assert.deepEqual(inicio, {
    chave: "inicio-E-7",
    em: T0,
    html: '<div class="sistema">Execução E-7 iniciada · autônoma · <a href="/api/execucoes/7/prompt" target="_blank" rel="noopener">prompt da etapa</a></div>',
  });
  assert.deepEqual(fim, {
    chave: "fim-E-7",
    em: "2026-10-11T10:05:00.000Z",
    html: '<div class="sistema">Execução E-7 concluída</div>',
  });
  assert.equal(linhasDaExecucao(execucao(), 0).length, 1, "em andamento, só o início");
  const retomada = linhasDaExecucao(execucao({ modo: "interativo", resultado: "sucesso", terminadaEm: T0 }), 1);
  assert.match(String(retomada[0]?.html), /interativa · <a [^>]+>prompt<\/a>/);
  assert.equal(retomada[1]?.html, '<div class="sistema">Execução E-7 encerrada</div>');
  assert.match(String(linhasDaExecucao(execucao({ modo: "interativo" }), 0)[0]?.html), />prompt da etapa</);
  const consulta = linhasDaExecucao(
    execucao({ modo: "consulta", resultado: "falha", erro: "<pi> caiu", terminadaEm: T0 }),
    0,
  );
  assert.equal(consulta[0]?.html, '<div class="sistema">Execução E-7 iniciada · consulta</div>');
  assert.equal(consulta[1]?.html, '<div class="sistema">Execução E-7 falhou: &#60;pi&#62; caiu</div>');
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
    {
      execucoes: [
        execucao({
          resultado: "sucesso",
          iniciadaEm: "2026-10-11T10:00:00.000Z",
          terminadaEm: "2026-10-11T10:09:00.000Z",
        }),
      ],
    },
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
    ["inicio-E-7", "assistant-2", "user-4", "fim-E-7", "dialogo-d1"],
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
  assert.doesNotMatch(linha, /Concluir sessão/);
  const interativa = compositorDe(envio(cabecalho({ etapa: "sessao", modo: "interativo" }), "steer"));
  assert.doesNotMatch(interativa.linha, /Concluir sessão/);
});

test("envio em conversa: só enviar; na sessão em aberto, também concluir", () => {
  const conversa = compositorDe(
    envio(cabecalho({ estado: "aguardando_humano", motivo: "conversa", etapa: "registro" }), "steer"),
  );
  assert.equal(conversa.placeholder, "Responda ao agente");
  assert.doesNotMatch(conversa.linha, /segmento|Abortar|Concluir/);
  const aberta = compositorDe(
    envio(cabecalho({ estado: "aguardando_humano", motivo: "conversa", etapa: "sessao", modo: "interativo" }), "steer"),
  );
  assert.match(
    aberta.linha,
    /<button type="button" class="btn" data-concluir>Concluir sessão<\/button><button class="btn btn-primario">Enviar<\/button>/,
  );
  const consulta = compositorDe(
    envio(cabecalho({ estado: "aguardando_humano", motivo: "conversa", etapa: "sessao", modo: "consulta" }), "steer"),
  );
  assert.doesNotMatch(consulta.linha, /Concluir/);
});

test("envio em diálogo: o formulário do método, com Cancelar e Responder", () => {
  const com = (d: Record<string, unknown>) =>
    htmlDe(envio(cabecalho({ estado: "aguardando_humano", motivo: "dialogo", dialogos: [dialogo(d)] }), "steer"));
  const select = com({ method: "select", title: "Qual `<ordem>`?", options: ["A <1>", "B"] });
  assert.match(
    select,
    /^<form class="dialogo-ext" data-dialogo="d1" data-metodo="select"><span class="rotulo">O agente pergunta<\/span><div>Qual <code>&lt;ordem&gt;<\/code>\?<\/div>/,
  );
  assert.match(
    select,
    /<label><input type="radio" name="valor" value="A &#60;1&#62;" checked> A &#60;1&#62;<\/label><label><input type="radio" name="valor" value="B"> B<\/label>/,
  );
  assert.match(
    select,
    /data-cancelar>Cancelar<\/button><button class="btn btn-primario">Responder<\/button><\/div><\/form>$/,
  );
  assert.match(
    com({ method: "select", title: "t" }),
    /<div class="opcoes" role="radiogroup" aria-label="Opções"><\/div>/,
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

test("envio nos gates: só o aviso; terminada: Exportar histórico e Conversar sobre esta sessão", () => {
  const aviso = (sessao: Partial<Sessao>) =>
    htmlDe(envio(cabecalho({ estado: "aguardando_humano", ...sessao }), "steer"));
  assert.equal(
    aviso({ motivo: "gate_registro" }),
    '<div class="fim">A sessão de registro terminou. Decida no painel do gate; devolver envia o motivo ao agente e reabre a conversa.</div>',
  );
  assert.equal(
    aviso({ motivo: "gate_pr" }),
    '<div class="fim">A etapa terminou; a decisão do gate fica na página da issue.</div>',
  );
  assert.equal(
    aviso({ estado: "terminada", sessao: "a b" }),
    '<div class="fim">Sessão terminada; a conversa fica só para leitura.<div class="botoes"><a class="btn" href="/api/sessoes/a%20b/historico.md" download>Exportar histórico</a><button type="button" class="btn btn-primario" data-consulta>Conversar sobre esta sessão</button></div></div>',
  );
});

test("envio na falha: a instrução, o seletor de modelo esperando a issue e Responder e retomar", () => {
  const html = htmlDe(envio(cabecalho({ estado: "aguardando_humano", motivo: "falha" }), "steer"));
  assert.match(
    html,
    /^<form class="compositor falha-comp" data-retomar><div class="anexos" data-anexos hidden><\/div><textarea name="texto" rows="2" aria-label="Instrução" placeholder="Instrução para a próxima tentativa \(vai antes do prompt da etapa\)"><\/textarea>/,
  );
  assert.match(html, /<label class="dica-tecla rotulo-modelo">Modelo <span data-seletor-modelo><select [^>]*disabled/);
  assert.match(html, /<button class="btn btn-primario">Responder e retomar<\/button><\/div><\/div><\/form>$/);
  // + Anexar histórico também aqui, como no protótipo: o histórico vai com a instrução (F4 §6.8).
  assert.match(
    html,
    /<\/select><\/span><\/label><button type="button" class="btn btn-pequeno" data-anexar [^>]*>\+ Anexar histórico<\/button><div class="direita">/,
  );
});

test("envio que aceita mensagem: + Anexar histórico antes da dica", () => {
  for (const sessao of [{}, { estado: "aguardando_humano", motivo: "conversa" }] as Partial<Sessao>[]) {
    const { linha } = compositorDe(envio(cabecalho(sessao), "steer"));
    assert.match(linha, /data-anexar title="[^"]+">\+ Anexar histórico<\/button><span class="dica-tecla">/);
  }
});

const info = (s: Partial<InfoSessao> = {}): InfoSessao => ({ ...cabecalho().sessao, ...s });

test("anexos: etiquetas removíveis e o seletor das outras sessões, da mais recente para a mais antiga", () => {
  const a = info({ sessao: "2a7d9999", issue: 27, ticket: 114 });
  assert.equal(
    etiquetasDeAnexo([a]),
    '<span class="anexo">histórico de s-2a7d · I-27 · T-114<button type="button" data-remover-anexo="2a7d9999" title="Remover" aria-label="Remover o histórico de s-2a7d · I-27 · T-114">×</button></span>',
  );
  assert.equal(etiquetasDeAnexo([]), "");
  const velha = info({ sessao: "velha", desde: "2026-10-01T00:00:00.000Z", estado: "terminada", modo: "consulta" });
  const nova = info({ sessao: "nova", desde: "2026-10-12T00:00:00.000Z", etapa: "revisao", projeto: "<p>" });
  const html = seletorDeSessoes([velha, a, nova, info({ sessao: "esta" })], "esta", ["2a7d9999"]);
  assert.deepEqual(
    [...html.matchAll(/data-anexar-sessao="([^"]+)"/g)].map((m) => m[1]),
    ["nova", "velha"],
  );
  assert.match(
    html,
    /<button type="button" class="opcao-sessao" data-anexar-sessao="nova"><span class="id">I-4 · T-3<\/span><span>&#60;p&#62; · revisão · autônoma<\/span><span class="pill pill-rodando">rodando<\/span><span class="muted pequeno">s-nova<\/span><\/button>/,
  );
  assert.match(html, /consulta<\/span><span class="pill pill-neutro">terminada/);
  assert.match(html, /^<ul class="sessoes-anexo"><li>/);
  assert.equal(seletorDeSessoes([a], "x", ["2a7d9999"]), '<p class="muted">Nenhuma outra sessão para anexar.</p>');
});

test("erro da falha: a última execução, o erro do ticket escapado e o que ficou; nada fora da falha", () => {
  const falha = cabecalho(
    { estado: "aguardando_humano", motivo: "falha", execucao: 9 },
    { ticket: ticket({ status: "falhou", erro: "tempo limite de 30 min <atingido>." }) },
  );
  assert.deepEqual(erroDaFalha(falha), [
    {
      chave: "falha-E-9",
      html: '<div class="erro-bloco" role="alert"><strong>Execução E-9 falhou:</strong> tempo limite de 30 min &#60;atingido&#62;. O ticket T-3 ficou <strong>falhou</strong>; o trabalho na worktree foi mantido.</div>',
    },
  ]);
  assert.deepEqual(erroDaFalha(cabecalho()), []);
  const itens = conversa({ ...falha, sessao: { ...falha.sessao, dialogos: [dialogo({ title: "t" })] } }, []);
  assert.deepEqual(
    itens.map((i) => i.id),
    ["inicio-E-7", "falha-E-9", "dialogo-d1"],
  );
});

const evidencia = (e: Partial<Evidencia>): Evidencia => ({
  id: 1,
  ticket: 3,
  tipo: "criterios_aceite",
  dados: {},
  arquivos: [],
  produtor: "agente",
  em: T0,
  ...e,
});

const pagina = (p: Partial<PaginaDaIssue> = {}): PaginaDaIssue =>
  ({
    issue: { ...cabecalho().issue, fase: "desenvolvimento" },
    percorridas: ["registro", "desenho", "aprovacao_desenho", "desenvolvimento"],
    tickets: [
      ticket({ id: 1, etapa: "registro", titulo: "Registrar", status: "concluido" }),
      ticket({ id: 2, titulo: "Teste de carga", status: "aberto" }),
      ticket({ id: 3, status: "falhou" }),
    ],
    evidencias: [
      evidencia({ id: 10, ticket: 1 }),
      evidencia({ id: 11, ticket: 1, tipo: "explicacao_fitness" }),
      evidencia({ id: 12, ticket: 3, tipo: "desenho_solucao", aprovada: true }),
    ],
    sessoes: [
      info({ sessao: "consulta-1", ticket: 1, modo: "consulta", estado: "terminada" }),
      info({ sessao: "principal-1", ticket: 1, modo: "interativo", estado: "terminada" }),
      info({ sessao: "s", ticket: 3, estado: "aguardando_humano", motivo: "falha" }),
    ],
    ...p,
  }) as PaginaDaIssue;

test("contexto da issue: I-n e projeto, trilho compacto, tickets com o desta sessão e os chats, artefatos e Abrir a issue", () => {
  const html = contextoDaIssue(pagina(), info({ sessao: "s", ticket: 3 }));
  assert.match(
    html,
    /^<section class="painel superficie contexto-issue" aria-label="Contexto da issue"><h3>I-4 · loja api<\/h3>/,
  );
  assert.match(
    html,
    /<div class="trilho-mini falha" role="img" aria-label="Fase: Desenvolvimento"><i class="feito" title="Registro"><\/i><i class="feito" title="Desenho"><\/i><i class="feito" title="Aprovação do desenho"><\/i><i class="atual" title="Desenvolvimento"><\/i><i title="Revisão"><\/i>/,
  );
  assert.match(
    html,
    /<li><span class="p concluido" aria-hidden="true"><\/span><span class="id">T-1<\/span><span class="t">Registrar<\/span><a class="link" href="\/sessions\/principal-1">chat<\/a><\/li>/,
  );
  assert.match(
    html,
    /<li><span class="p aberto" aria-hidden="true"><\/span><span class="id">T-2<\/span><span class="t">Teste de carga<\/span><\/li>/,
  );
  assert.match(
    html,
    /<li class="atual" aria-current="true"><span class="p falhou" aria-hidden="true"><\/span><span class="id">T-3<\/span><span class="t">Buscar &#60;cupons&#62;<\/span><span class="muted pequeno">esta<\/span><\/li>/,
  );
  assert.deepEqual(
    [...html.matchAll(/data-evidencia="(\d+)"/g)].map((m) => m[1]),
    ["10", "12"],
  );
  // Cada card diz de que ticket é: com dois tickets de desenvolvimento, os Testes de um e do outro se distinguem.
  assert.deepEqual(
    [...html.matchAll(/<button type="button" class="art" data-evidencia="\d+">.*?<\/button>/g)].map((m) =>
      m[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
    ["TABELA Critérios de aceite T-1", "JSON Desenho da solução T-3"],
  );
  assert.match(html, /<a class="link" href="\/projects\/loja%20api\/issues\/I-4">Abrir a issue →<\/a><\/section>$/);

  const concluida = contextoDaIssue(
    pagina({
      issue: { ...cabecalho().issue, fase: "concluida" },
      percorridas: [
        "registro",
        "desenho",
        "aprovacao_desenho",
        "desenvolvimento",
        "revisao",
        "encerramento",
        "aprovacao_pr",
      ],
      evidencias: [],
      sessoes: [],
    }),
    info(),
  );
  // O ajuste do PR, que não aconteceu, fica neutro.
  assert.match(
    concluida,
    /<div class="trilho-mini" role="img" aria-label="Fase: Concluída">(<i class="feito" [^>]+><\/i>){7}<i title="Ajuste do PR"><\/i><\/div>/,
  );
  assert.match(concluida, /<p class="muted pequeno">Nenhum artefato ainda.<\/p>/);
});

test("lateral no registro: o formulário de C2 com o que está registrado", () => {
  const c = cabecalho({ estado: "aguardando_humano", motivo: "conversa", etapa: "registro" });
  const registro = {
    ...c,
    issue: { ...c.issue, fase: "registro" as const, titulo: null, tipo: null, descricao: "a <b>" },
  };
  const html = lateral(registro, 0);
  assert.match(html, /^<form class="painel superficie" data-registro><h3>Registro · você pode corrigir direto<\/h3>/);
  assert.match(html, /<input name="titulo" value="" autocomplete="off">/);
  assert.match(
    html,
    /<select name="tipo"><option value="" selected>—<\/option><option value="funcionalidade">funcionalidade<\/option><option value="problema">problema<\/option><\/select>/,
  );
  assert.match(html, /<textarea name="descricao" rows="5">a &#60;b&#62;<\/textarea>/);
  const preenchido = lateral({ ...registro, issue: { ...registro.issue, titulo: "T <1>", tipo: "problema" } }, 0);
  assert.match(preenchido, /value="T &#60;1&#62;"/);
  assert.match(
    preenchido,
    /<select name="tipo"><option value="funcionalidade">funcionalidade<\/option><option value="problema" selected>problema<\/option>/,
  );
  assert.equal(
    lateral({ ...registro, issue: { ...registro.issue, fase: "desenho" } }, 0),
    "",
    "depois do registro, nada",
  );
  assert.equal(lateral(cabecalho(), 0), "");
});

test("lateral no gate do registro: o que foi registrado, os critérios, o que falta e a decisão", () => {
  const c = cabecalho(
    { estado: "aguardando_humano", motivo: "gate_registro", etapa: "registro" },
    {
      registro: {
        comportamento: "copia <à> **mão**",
        criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "o <CSV>" }],
        faltando: [],
      },
    },
  );
  const html = lateral(c, Date.parse(T0) + 120_000);
  assert.match(
    html,
    /^<section class="gate-reg" aria-label="Gate do registro"><div class="cab"><span class="rotulo">Gate do registro<\/span><span class="muted pequeno">aguarda você há 2\u00a0min<\/span>/,
  );
  assert.match(
    html,
    /<dt>Título<\/dt><dd>Timeout &#60;no&#62; checkout<\/dd><dt>Tipo<\/dt><dd><span class="tag">problema<\/span><\/dd><dt>Descrição<\/dt><dd>—<\/dd><dt>Comportamento<\/dt><dd><div class="md"><p>copia &lt;à&gt; <strong>mão<\/strong><\/p>\n<\/div><\/dd>/,
  );
  // A tabela de critérios_aceite da página da issue (F7 §4.5): id, dado, quando, então.
  assert.match(
    html,
    /<thead><tr><th>ID<\/th><th>Dado<\/th><th>Quando<\/th><th>Então<\/th><\/tr><\/thead><tbody><tr><td class="mono">CA-1<\/td><td class="md">d<\/td><td class="md">q<\/td><td class="md">o &lt;CSV&gt;<\/td><\/tr>/,
  );
  assert.match(html, /Nenhuma evidência faltando./);
  assert.match(
    html,
    /data-devolver disabled>Devolver<\/button><button class="btn btn-primario">Aprovar registro<\/button>/,
  );
  const faltando = lateral(
    { ...c, registro: { comportamento: "x", criterios: [], faltando: ["comportamento", "criterios_aceite"] } },
    0,
  );
  assert.match(faltando, /Faltam evidências: comportamento, criterios_aceite./);
  assert.match(
    lateral({ ...c, issue: { ...c.issue, descricao: "d *e*" }, registro: undefined }, 0),
    /<dd><div class="md"><p>d <em>e<\/em><\/p>\n<\/div><\/dd><dt>Comportamento<\/dt><dd>—<\/dd>.*Nenhuma evidência faltando/,
  );
});

test("lateral nos gates de desenho e de PR: só o aviso com Decidir na página da issue", () => {
  for (const [motivo, rotulo] of [
    ["gate_desenho", "Gate do desenho"],
    ["gate_pr", "Gate do PR"],
  ] as const) {
    const html = lateral(cabecalho({ estado: "aguardando_humano", motivo }), 0);
    assert.match(html, new RegExp(`^<section class="gate-reg" aria-label="${rotulo}">`));
    assert.match(
      html,
      /<a class="btn btn-primario" href="\/projects\/loja%20api\/issues\/I-4">Decidir na página da issue<\/a>/,
    );
  }
});

test("edição do registro: só título e tipo preenchidos; a descrição vai sempre", () => {
  assert.deepEqual(edicaoDoRegistro({ titulo: "  ", tipo: "", descricao: "" }), { descricao: "" });
  assert.deepEqual(edicaoDoRegistro({ titulo: " T ", tipo: "problema", descricao: "d" }), {
    titulo: "T",
    tipo: "problema",
    descricao: "d",
  });
});
