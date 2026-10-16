// Chat (F7 §4.4; F4 §5.4, §6.4, §6.5, §6.8): a barra de estado, a conversa do JSONL com as linhas do sistema e o
// erro da falha, as peças que chegam ao vivo, o envio conforme o estado com os anexos de histórico, e a coluna da
// direita com o registro e o contexto da issue, como funções puras que devolvem HTML. O texto de agente passa sempre
// pelo `markdown-it` com `html: false`; o resto, por `escapar`.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Execucao } from "../../../dominio/agregado.ts";
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { CabecalhoDoChat, Entrada } from "../../rotas/chat.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import { markdown, markdownEmLinha } from "../markdown.ts";
import {
  caminhoDaIssue,
  caminhoDaSessao,
  escapar,
  estadoDoTrilho,
  etapa,
  FASES,
  MODO_DA_SESSAO,
  nomeDoModelo,
  plural,
  rotuloDoModelo,
  rotuloIssue,
  rotuloTicket,
  situacaoDasFases,
} from "../render.ts";
import { cardDaEvidencia, cartaoDaProposta, comCard } from "./issue.ts";

/** Um bloco do `content` de uma mensagem do pi. */
export interface Bloco {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

/** Uma mensagem do pi (usuário, agente ou resultado de ferramenta), como vem no JSONL e no `message_end`. */
export interface MensagemPi {
  role?: string;
  content?: string | Bloco[];
  toolCallId?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
}

/** Um pedaço da conversa com a chave que o identifica, para o que chega ao vivo não repetir o que já está na tela. */
export interface Item {
  chave: string;
  html: string;
}

export const blocos = (m: MensagemPi): Bloco[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);

export const textoDe = (m: MensagemPi): string =>
  blocos(m)
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");

const MOTIVOS: Record<NonNullable<CabecalhoDoChat["sessao"]["motivo"]>, string> = {
  conversa: "conversa",
  dialogo: "diálogo",
  falha: "falha",
  gate_registro: "gate do registro",
  gate_desenho: "gate do desenho",
  gate_pr: "gate do PR",
};

/** O estado da sessão (F4 §5.2) como etiqueta: azul rodando, âmbar aguardando, vermelho na falha. */
export function etiquetaDoEstado({ estado, motivo }: CabecalhoDoChat["sessao"]): string {
  if (estado === "rodando") return '<span class="pill pill-rodando">rodando</span>';
  if (estado === "terminada") return '<span class="pill pill-neutro">terminada</span>';
  const classe = motivo === "falha" ? "pill-falha" : "pill-aguarda";
  return `<span class="pill ${classe}">aguarda você · ${motivo ? MOTIVOS[motivo] : ""}</span>`;
}

/** O modelo da sessão: o da última execução, senão o da última resposta do agente, senão o padrão do pi. */
export function modeloDe(c: CabecalhoDoChat, conversa: readonly Entrada[]): string {
  const fixado = c.execucoes.at(-1)?.modelo;
  if (fixado) return nomeDoModelo(fixado);
  const resposta = conversa.map((e) => e.message as MensagemPi | undefined).findLast((m) => m?.role === "assistant");
  return resposta?.model
    ? nomeDoModelo({ provedor: String(resposta.provider), modelo: resposta.model })
    : "modelo padrão do pi";
}

/** **Exportar histórico** (F4 §6.8): o Markdown da sessão, baixado. */
const exportar = (sessao: string, classe: string, rotulo = "Exportar"): string =>
  `<a class="${classe}" href="/api/sessoes/${encodeURIComponent(sessao)}/historico.md" download>${rotulo}</a>`;

/**
 * Barra de estado (F7 §4.4, item 1): issue, ticket, etapa e modo, estado, modelo, a execução com log e prompt,
 * **Exportar** e **Conversar sobre**.
 */
export function barraDeEstado(c: CabecalhoDoChat, modelo: string): string {
  const { sessao, issue } = c;
  const e = String(sessao.execucao);
  const titulo = issue.titulo ?? "sem título";
  return (
    `<div class="estado-sessao">` +
    `<a class="issue" href="${caminhoDaIssue(issue.projeto, issue.id)}"><span class="id">${rotuloIssue(issue.id)}</span> ${escapar(titulo)}</a>` +
    `<span class="sep">│</span><span class="id">${rotuloTicket(sessao.ticket)}</span>` +
    `<span class="muted">${etapa(sessao.etapa)} · ${MODO_DA_SESSAO[sessao.modo]}</span>${etiquetaDoEstado(sessao)}` +
    rotuloDoModelo(modelo) +
    `<div class="direita"><span class="muted pequeno">E-${e}</span>` +
    `<a class="link" href="/api/execucoes/${e}/log" target="_blank" rel="noopener">log</a>` +
    `<a class="link" href="/api/execucoes/${e}/prompt" target="_blank" rel="noopener">prompt</a>` +
    `${exportar(sessao.sessao, "link")}<button type="button" class="link" data-consulta>Conversar sobre</button></div>` +
    `</div>`
  );
}

const sistema = (html: string): string => `<div class="sistema">${html}</div>`;

/** As linhas do sistema de uma execução: quando começou e, se já terminou, como terminou. */
export function linhasDaExecucao(e: Execucao, i: number): (Item & { em: string })[] {
  const n = `E-${String(e.id)}`;
  // O prompt da etapa (F4 §6.3) abre a sessão e cada execução autônoma; a retomada interativa leva só a mensagem.
  const rotulo = i === 0 || e.modo === "autonomo" ? "prompt da etapa" : "prompt";
  const prompt =
    e.modo === "consulta"
      ? ""
      : ` · <a href="/api/execucoes/${String(e.id)}/prompt" target="_blank" rel="noopener">${rotulo}</a>`;
  const linhas = [
    {
      chave: `inicio-${n}`,
      em: e.iniciadaEm,
      html: sistema(`Execução ${n} iniciada · ${MODO_DA_SESSAO[e.modo]}${prompt}`),
    },
  ];
  if (e.terminadaEm === undefined) return linhas;
  let fim = `Execução ${n} encerrada`;
  if (e.resultado === "falha") fim = `Execução ${n} falhou: ${escapar(e.erro)}`;
  else if (e.modo === "autonomo") fim = `Execução ${n} concluída`;
  return [...linhas, { chave: `fim-${n}`, em: e.terminadaEm, html: sistema(fim) }];
}

/**
 * O erro da falha em destaque no fim da conversa (F7 §4.4, item 3): a última execução, o erro do ticket (C8) e o que
 * ficou. Nada fora da falha.
 */
export function erroDaFalha({ sessao, ticket }: CabecalhoDoChat): Item[] {
  if (sessao.motivo !== "falha") return [];
  const e = `E-${String(sessao.execucao)}`;
  const erro = escapar(String(ticket.erro).replace(/\.$/, ""));
  return [
    {
      chave: `falha-${e}`,
      html: `<div class="erro-bloco" role="alert"><strong>Execução ${e} falhou:</strong> ${erro}. O ticket ${rotuloTicket(ticket.id)} ficou <strong>falhou</strong>; o trabalho na worktree foi mantido.</div>`,
    },
  ];
}

/** Uma linha por diálogo de extensão aberto pelo agente. */
export const linhaDoDialogo = (d: Dialogo): Item => ({
  chave: `dialogo-${String(d.id)}`,
  html: sistema(`o agente abriu um diálogo: ${markdownEmLinha(String(d.title))}`),
});

/** O que a chamada recebeu, numa linha: o comando, o caminho ou os argumentos em JSON. */
function argumentos(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  for (const campo of ["command", "path"]) if (typeof a[campo] === "string") return a[campo];
  return JSON.stringify(a);
}

/** Linhas a partir das quais a saída da ferramenta rola e ganha **ver tudo**. */
const LINHAS_VISIVEIS = 10;

/** O resumo do resultado de uma ferramenta: ✓ ou ✗ com o número de linhas da saída. */
function resumoDoResultado(resultado: MensagemPi): { ok: boolean; resumo: string; linhas: number } {
  const texto = textoDe(resultado);
  const linhas = texto === "" ? 0 : texto.split("\n").length;
  const quantas = linhas === 0 ? "sem saída" : plural(linhas, "linha", "linhas");
  const ok = !resultado.isError;
  return { ok, resumo: `${ok ? "✓" : "✗"} ${quantas}`, linhas };
}

/**
 * Uma chamada de ferramenta, recolhível: nome, argumentos e o resumo do resultado (✓ ou ✗ com o número de linhas), e a
 * saída em fonte monoespaçada, com **ver tudo** quando passa de algumas linhas. Sem resultado ainda, diz que espera.
 */
export function corpoDaFerramenta(chamada: Bloco, resultado?: MensagemPi): string {
  let resumo = '<span class="res neutro">sem resultado ainda</span>';
  let saida = "";
  if (resultado) {
    const texto = textoDe(resultado);
    const r = resumoDoResultado(resultado);
    const { linhas } = r;
    resumo = `<span class="res ${r.ok ? "ok" : "nok"}">${r.resumo}</span>`;
    const ver =
      linhas > LINHAS_VISIVEIS ? '<button type="button" class="link ver" data-ver-tudo>ver tudo</button>' : "";
    saida = linhas === 0 ? "" : `<pre>${escapar(texto)}</pre>${ver}`;
  }
  return `<summary><span class="nome-f">${escapar(chamada.name)}</span><span class="args">${escapar(argumentos(chamada.arguments))}</span>${resumo}</summary>${saida}`;
}

/** A chamada recolhível inteira, como a prévia do Histórico a desenha; no chat, o `<details>` é do componente. */
export const ferramenta = (chamada: Bloco, resultado?: MensagemPi): string =>
  `<details class="ferramenta" data-chamada="${escapar(chamada.id)}">${corpoDaFerramenta(chamada, resultado)}</details>`;

type Parte = Exclude<ThreadMessageLike["content"], string>[number];

/** Uma linha do sistema como mensagem do assistant-ui: o HTML, já escapado, vai em `metadata.custom.html`. */
export const doSistema = ({ chave, html }: Item): ThreadMessageLike => ({
  id: chave,
  role: "system",
  content: [{ type: "text", text: "" }],
  metadata: { custom: { html } },
});

const PAROU: Record<string, string> = { aborted: "o agente foi interrompido", error: "o agente parou com erro" };

/** A mensagem da Fabriquinha ao agente (o aviso de uma proposta decidida), com o rótulo dela. */
const daFabriquinha = (m: MensagemPi): string =>
  `<div class="msg fabriquinha"><span class="quem">Fabriquinha</span><div class="balao md">${markdown(textoDe(m))}</div></div>`;

/** Os cartões das propostas de issue abertas do registro, entre a conversa e o envio. */
export const propostasDoChat = (c: CabecalhoDoChat): string =>
  (c.propostas ?? []).map((p) => cartaoDaProposta(p, false, c.issue.id)).join("");

/** A chamada de ferramenta como parte do assistant-ui; o bloco do pi e o resultado vão inteiros em `artifact`. */
const parteDaChamada = (b: Bloco, resultado?: MensagemPi): Parte => ({
  type: "tool-call",
  toolCallId: String(b.id),
  toolName: String(b.name),
  artifact: { chamada: b, resultado },
});

/**
 * Uma mensagem do pi como mensagens do assistant-ui: a do Auditor, e a do agente com o raciocínio, o texto e as
 * chamadas na ordem em que vieram, mais a linha do sistema quando ele parou. O resultado de uma ferramenta não aparece
 * sozinho: ele completa a chamada (`resultados`, por id).
 */
export function mensagem(
  m: MensagemPi,
  resultados: ReadonlyMap<string, MensagemPi> = new Map(),
  aviso = false,
): ThreadMessageLike[] {
  const id = chaveDa(m);
  if (m.role === "user" && aviso) return [doSistema({ chave: id, html: daFabriquinha(m) })];
  if (m.role === "user") return [{ id, role: "user", content: [{ type: "text", text: textoDe(m) }] }];
  if (m.role !== "assistant") return [];
  const content = blocos(m).flatMap((b): Parte[] => {
    if (b.type === "thinking") return [{ type: "reasoning", text: String(b.thinking) }];
    if (b.type === "toolCall") return [parteDaChamada(b, resultados.get(String(b.id)))];
    return b.type === "text" && b.text?.trim() ? [{ type: "text", text: b.text }] : [];
  });
  const parou = PAROU[String(m.stopReason)];
  return [
    ...(content.length > 0 ? [{ id, role: "assistant" as const, content }] : []),
    ...(parou
      ? [
          doSistema({
            chave: `${id}-parou`,
            html: sistema(escapar([parou, m.errorMessage].filter(Boolean).join(": "))),
          }),
        ]
      : []),
  ];
}

/** A mensagem do agente com o resultado da ferramenta na chamada dele; outra mensagem fica como está. */
export function comResultado(m: ThreadMessageLike, resultado: MensagemPi): ThreadMessageLike {
  if (typeof m.content === "string") return m;
  const content = m.content.map((p) =>
    p.type === "tool-call" && p.toolCallId === resultado.toolCallId
      ? parteDaChamada((p.artifact as { chamada: Bloco }).chamada, resultado)
      : p,
  );
  return { ...m, content };
}

/** A chave de uma mensagem: o papel e o instante dela no pi, que o JSONL e o `message_end` repetem. */
export const chaveDa = (m: MensagemPi): string => `${String(m.role)}-${String(m.timestamp)}`;

/**
 * A conversa inteira (F7 §4.4, item 2): as mensagens do JSONL e as linhas das execuções, por instante, e no fim o
 * erro da falha e os diálogos abertos. O prompt montado pela Fabriquinha não aparece: a linha da execução tem o link dele.
 */
export function conversa(c: CabecalhoDoChat, entradas: readonly Entrada[]): ThreadMessageLike[] {
  const mensagens = entradas.flatMap((e) =>
    e.type === "message"
      ? [{ em: String(e.timestamp), m: e.message as MensagemPi, fabriquinha: e.fabriquinha, aviso: e.aviso }]
      : [],
  );
  const resultados = new Map(
    mensagens.filter(({ m }) => m.role === "toolResult").map(({ m }) => [String(m.toolCallId), m] as const),
  );
  const itens = [
    ...mensagens.map(({ em, m, fabriquinha, aviso }) => ({
      em,
      lista: fabriquinha ? [] : mensagem(m, resultados, aviso === true),
    })),
    ...c.execucoes.flatMap((e, i) => linhasDaExecucao(e, i)).map((l) => ({ em: l.em, lista: [doSistema(l)] })),
  ].toSorted((a, b) => a.em.localeCompare(b.em));
  return [
    ...itens.flatMap(({ lista }) => lista),
    ...erroDaFalha(c).map(doSistema),
    ...c.sessao.dialogos.map(linhaDoDialogo).map(doSistema),
  ];
}

/** A mensagem do agente chegando em fluxo: id `fluxo`, que o componente desenha com o cursor no fim do texto. */
export const emFluxo = (texto: string, raciocinio: string): ThreadMessageLike => ({
  id: "fluxo",
  role: "assistant",
  content: [
    ...(raciocinio ? [{ type: "reasoning" as const, text: raciocinio }] : []),
    { type: "text" as const, text: texto },
  ],
});

/** O Markdown do texto com o cursor piscando no fim, dentro do último parágrafo. */
export function comCursor(html: string): string {
  return html.endsWith("</p>\n")
    ? `${html.slice(0, -"</p>\n".length)}<span class="cursor"></span></p>`
    : `${html}<span class="cursor"></span>`;
}

export type ModoEnvio = "steer" | "follow_up";

const DICA = '<span class="dica-tecla">Enter envia · Shift+Enter quebra linha</span>';

/** O pedido do agente (F4 §5.4) com o formulário do método: lista de opções, Sim/Não, texto ou área de texto. */
function dialogo(d: Dialogo): string {
  const opcoes = (valores: [string, string][]) =>
    `<div class="opcoes" role="radiogroup" aria-label="Opções">${valores
      .map(
        ([valor, rotulo], i) =>
          `<label><input type="radio" name="valor" value="${escapar(valor)}"${i === 0 ? " checked" : ""}> ${escapar(rotulo)}</label>`,
      )
      .join("")}</div>`;
  const campos: Record<string, () => string> = {
    select: () => opcoes(((d.options ?? []) as string[]).map((o) => [o, o])),
    confirm: () =>
      opcoes([
        ["sim", "Sim"],
        ["nao", "Não"],
      ]),
    input: () =>
      `<input name="valor" aria-label="Resposta" placeholder="${escapar(d.placeholder ?? "")}" autocomplete="off">`,
    editor: () => `<textarea name="valor" rows="6" aria-label="Resposta">${escapar(d.prefill ?? "")}</textarea>`,
  };
  const detalhe = typeof d.message === "string" ? `<div class="muted md">${markdown(d.message)}</div>` : "";
  const campo = campos[String(d.method)];
  // Só os 4 métodos chegam (P1 §2.1); outro, o Auditor só pode cancelar.
  const corpo = campo
    ? campo()
    : `<p class="muted">A Fabriquinha não sabe responder a este pedido (${escapar(d.method)}); cancele para o agente seguir.</p>`;
  return (
    `<form class="dialogo-ext" data-dialogo="${escapar(d.id)}" data-metodo="${escapar(d.method)}">` +
    `<span class="rotulo">O agente pergunta</span><div>${markdownEmLinha(String(d.title))}</div>${detalhe}${corpo}` +
    '<div class="botoes"><button type="button" class="btn" data-cancelar>Cancelar</button>' +
    `${campo ? '<button class="btn btn-primario">Responder</button>' : ""}</div></form>`
  );
}

/** O corpo de `POST /api/sessoes/:sessao/dialogos/:id` para o valor escolhido no formulário do diálogo. */
export const respostaDoDialogo = (metodo: string, valor: string): { valor: string } | { confirmado: boolean } =>
  metodo === "confirm" ? { confirmado: valor === "sim" } : { valor };

const fim = (texto: string, botoes = ""): string =>
  `<div class="fim">${texto}${botoes && '<div class="botoes">' + botoes + "</div>"}</div>`;

const ANEXAR =
  '<button type="button" class="btn btn-pequeno" data-anexar title="Levar o histórico de outra sessão para esta conversa">+ Anexar histórico</button>';

/** Os anexos de histórico da mensagem como etiquetas removíveis; o envio os leva em `anexos` (F4 §6.8). */
export function etiquetasDeAnexo(anexos: readonly InfoSessao[]): string {
  return anexos
    .map(
      (s) =>
        `<span class="anexo">histórico de ${rotuloDaSessao(s)}<button type="button" data-remover-anexo="${escapar(s.sessao)}" title="Remover" aria-label="Remover o histórico de ${rotuloDaSessao(s)}">×</button></span>`,
    )
    .join("");
}

/** `s-2a7d · I-27 · T-114`: o começo do id da sessão, a issue e o ticket. */
const rotuloDaSessao = (s: InfoSessao): string =>
  `s-${escapar(s.sessao.slice(0, 4))} · ${rotuloIssue(s.issue)} · ${rotuloTicket(s.ticket)}`;

/**
 * O seletor de sessões do **+ Anexar histórico**, na caixa: as outras sessões, ativas e do histórico, da mais recente
 * para a mais antiga, sem a desta conversa e sem as já anexadas.
 */
export function seletorDeSessoes(sessoes: readonly InfoSessao[], atual: string, anexadas: readonly string[]): string {
  const opcoes = sessoes
    .filter((s) => s.sessao !== atual && !anexadas.includes(s.sessao))
    .toSorted((a, b) => b.desde.localeCompare(a.desde))
    .map(
      (s) =>
        `<li><button type="button" class="opcao-sessao" data-anexar-sessao="${escapar(s.sessao)}"><span class="id">${rotuloIssue(s.issue)} · ${rotuloTicket(s.ticket)}</span><span>${escapar(s.projeto)} · ${etapa(s.etapa)} · ${MODO_DA_SESSAO[s.modo]}</span>${etiquetaDoEstado(s)}<span class="muted pequeno">s-${escapar(s.sessao.slice(0, 4))}</span></button></li>`,
    );
  return opcoes.length
    ? `<ul class="sessoes-anexo">${opcoes.join("")}</ul>`
    : '<p class="muted">Nenhuma outra sessão para anexar.</p>';
}

/**
 * Na falha (F4 §6.4): a instrução para a próxima tentativa, o modelo (C20, preenchido com a issue), os anexos de
 * histórico, que vão com a instrução (F4 §6.8), e o C9.
 */
const retomar =
  '<form class="compositor falha-comp" data-retomar><div class="anexos" data-anexos hidden></div><textarea name="texto" rows="2" aria-label="Instrução" placeholder="Instrução para a próxima tentativa (vai antes do prompt da etapa)"></textarea>' +
  `<div class="linha-1"><label class="dica-tecla rotulo-modelo">Modelo <span data-seletor-modelo><select class="seletor-modelo" disabled aria-label="Modelo"><option>carregando…</option></select></span></label>${ANEXAR}` +
  '<div class="direita"><button class="btn btn-primario">Responder e retomar</button></div></div></form>';

/**
 * A área de envio (F7 §4.4, item 3), conforme o estado: rodando, redirecionar ou enfileirar e abortar; diálogo, o
 * formulário dele; conversa, enviar e, na sessão em aberto, concluir; nos gates e terminada, só o aviso.
 */
export type Envio = { html: string } | { placeholder: string; linha: string };

export function envio(c: CabecalhoDoChat, modo: ModoEnvio): Envio {
  const { sessao } = c;
  const [pendente] = sessao.dialogos;
  if (pendente) return { html: dialogo(pendente) };
  if (sessao.estado === "terminada") {
    return {
      html: fim(
        "Sessão terminada; a conversa fica só para leitura.",
        exportar(sessao.sessao, "btn", "Exportar histórico") +
          '<button type="button" class="btn btn-primario" data-consulta>Conversar sobre esta sessão</button>',
      ),
    };
  }
  if (sessao.motivo === "falha") return { html: retomar };
  const rodando = sessao.estado === "rodando";
  if (!rodando && sessao.motivo !== "conversa") {
    return {
      html: fim(
        sessao.motivo === "gate_registro" || sessao.motivo === "gate_desenho"
          ? "O agente enviou o resultado à sua aprovação. Decida na página da issue; devolver traz o motivo de volta a esta conversa."
          : "A etapa terminou; a decisão do gate fica na página da issue.",
      ),
    };
  }
  const segmento = rodando
    ? '<div class="segmento" role="group" aria-label="Como enviar">' +
      `<button type="button" data-modo="steer" aria-pressed="${String(modo === "steer")}" title="Interrompe e redireciona agora">Redirecionar</button>` +
      `<button type="button" data-modo="follow_up" aria-pressed="${String(modo === "follow_up")}" title="Entrega quando o agente terminar o passo">Enfileirar</button></div>`
    : "";
  const acoes = [
    rodando ? '<button type="button" class="btn btn-perigo" data-abortar>Abortar</button>' : "",
    // C14 só na conversa da sessão em aberto (F7 §4.4): não rodando e não numa consulta.
    !rodando && sessao.modo === "interativo" && sessao.etapa === "sessao"
      ? '<button type="button" class="btn" data-concluir>Concluir sessão</button>'
      : "",
    '<button class="btn btn-primario">Enviar</button>',
  ].join("");
  return {
    placeholder: rodando ? "Mensagem para o agente enquanto ele trabalha" : "Responda ao agente",
    linha: `${segmento}${ANEXAR}${DICA}<div class="direita">${acoes}</div>`,
  };
}

/** O formulário de C2 (F7 §4.4, item 4): o Auditor corrige direto o que o agente registrou. */
function formularioDoRegistro(c: CabecalhoDoChat): string {
  const { titulo, tipo, descricao } = c.issue;
  const opcao = (valor: string, rotulo: string) =>
    `<option value="${valor}"${tipo === valor || (valor === "" && tipo === null) ? " selected" : ""}>${rotulo}</option>`;
  return (
    '<form class="painel superficie" data-registro><h3>Registro · você pode corrigir direto</h3>' +
    `<label class="campo">Título<input name="titulo" value="${escapar(titulo ?? "")}" autocomplete="off"></label>` +
    `<label class="campo">Tipo<select name="tipo">${tipo === null ? opcao("", "—") : ""}${opcao("funcionalidade", "funcionalidade")}${opcao("problema", "problema")}</select></label>` +
    `<label class="campo">Descrição<textarea name="descricao" rows="5">${escapar(descricao)}</textarea></label>` +
    '<div class="salvar"><button class="btn btn-pequeno">Salvar</button></div></form>'
  );
}

const ROTULO_DO_GATE: Record<string, string> = {
  gate_registro: "Gate do registro",
  gate_desenho: "Gate do desenho",
  gate_pr: "Gate do PR",
};

/**
 * A coluna da direita (F7 §4.4, item 4): na conversa do registro, o formulário de C2; nos gates, só o aviso que leva à
 * página da issue, onde o Auditor decide.
 */
export function lateral(c: CabecalhoDoChat): string {
  const { sessao, issue } = c;
  const gate = ROTULO_DO_GATE[String(sessao.motivo)];
  if (gate) {
    return (
      `<section class="gate-reg" aria-label="${gate}"><div class="cab"><span class="rotulo">${gate}</span></div>` +
      '<div class="corpo">A decisão deste gate fica na página da issue, com tudo o que ela precisa.' +
      `<a class="btn btn-primario" href="${caminhoDaIssue(issue.projeto, issue.id)}">Decidir na página da issue</a></div></section>`
    );
  }
  return sessao.etapa === "registro" && issue.fase === "registro" ? formularioDoRegistro(c) : "";
}

/** O trilho de fases compacto: uma barra por fase, as passadas em verde e a atual com a cor do estado. */
function trilhoCompacto(p: PaginaDaIssue): string {
  const estado = estadoDoTrilho(p.sessoes.filter((s) => s.estado !== "terminada"));
  const barras = situacaoDasFases(p.issue.fase, p.percorridas).map(({ rotulo, situacao }) => {
    const atributo = situacao && ' class="' + situacao + '"';
    return `<i${atributo} title="${rotulo}"></i>`;
  });
  const nome = FASES.find(([f]) => f === p.issue.fase)?.[1] ?? "Concluída";
  return `<div class="${["trilho-mini", estado].filter(Boolean).join(" ")}" role="img" aria-label="Fase: ${nome}">${barras.join("")}</div>`;
}

/**
 * O contexto da issue (F7 §4.4, item 4): `I-n` e projeto, o trilho compacto, os tickets com o desta sessão marcado e
 * o chat da sessão principal dos outros, os artefatos como cards que abrem na caixa e **Abrir a issue**.
 */
export function contextoDaIssue(p: PaginaDaIssue, sessao: InfoSessao): string {
  const tickets = p.tickets.map((t) => {
    const desta = t.id === sessao.ticket;
    const principal = p.sessoes.find((s) => s.ticket === t.id && s.modo !== "consulta");
    let lado = "";
    if (desta) lado = '<span class="muted pequeno">esta</span>';
    else if (principal) lado = `<a class="link" href="${caminhoDaSessao(principal.sessao)}">chat</a>`;
    return `<li${desta ? ' class="atual" aria-current="true"' : ""}><span class="p ${t.status}" aria-hidden="true"></span><span class="id">${rotuloTicket(t.id)}</span><span class="t">${escapar(t.titulo)}</span>${lado}</li>`;
  });
  const cards = comCard(p)
    .map((e) => cardDaEvidencia(e, true))
    .join("");
  const artefatos = cards
    ? '<div class="cards-art">' + cards + "</div>"
    : '<p class="muted pequeno">Nenhum artefato ainda.</p>';
  return (
    `<section class="painel superficie contexto-issue" aria-label="Contexto da issue"><h3>${rotuloIssue(p.issue.id)} · ${escapar(p.issue.projeto)}</h3>` +
    trilhoCompacto(p) +
    `<div><div class="titulo-bloco">Tickets e sessões</div><ul class="tickets-da-issue">${tickets.join("")}</ul></div>` +
    `<div><div class="titulo-bloco">Artefatos</div>${artefatos}</div>` +
    `<a class="link" href="${caminhoDaIssue(p.issue.projeto, p.issue.id)}">Abrir a issue →</a></section>`
  );
}

/** O corpo de `POST /api/issues/:id` a partir do formulário: só os campos preenchidos; a descrição pode ficar vazia. */
export function edicaoDoRegistro(campos: { titulo: string; tipo: string; descricao: string }): Record<string, string> {
  const titulo = campos.titulo.trim();
  return {
    ...(titulo && { titulo }),
    ...(campos.tipo && { tipo: campos.tipo }),
    descricao: campos.descricao,
  };
}
