// Início (F7 §4.4; comparacao-sdlc §9.1) como funções puras: a frase do mês, o que aguarda o Auditor, o que roda e o
// board das demandas em andamento, com as colunas por fase da demanda e, na execução, por fase da rodada. O DOM e a
// rede ficam em inicio-montar.ts.
import type {
  CartaoDoBoard,
  ColunaDoBoard,
  DadosDoInicio,
  EsperaDoAuditor,
  MotivoDaEspera,
  SessaoRodando,
} from "../../rotas/inicio.ts";
import {
  caminhoDaDemanda,
  caminhoDaSessao,
  escapar,
  ha,
  MODO_DA_SESSAO,
  nomeDoModelo,
  plural,
  rotuloDoModelo,
  STATUS_DO_TICKET,
} from "../render.ts";
import { ETAPA_DO_TICKET } from "./demandas.ts";
import { fraseDoMes } from "./metricas.ts";

/** Cada motivo de espera: o título do cartão, a marca no board e o botão que leva aonde se decide. */
const MOTIVOS: Record<MotivoDaEspera, { titulo: string; marca: string; acao: string }> = {
  gate_demanda: { titulo: "Gate da demanda", marca: "gate da demanda", acao: "Avaliar a demanda" },
  gate_planejamento: { titulo: "Gate do planejamento", marca: "gate do plano", acao: "Avaliar o plano" },
  gate_pr: { titulo: "Gate do PR", marca: "gate do PR", acao: "Ver o PR" },
  ajustes: { titulo: "Ajustes do PR", marca: "ajustes do PR", acao: "Conversar" },
  falha: { titulo: "Falhou", marca: "falha", acao: "Reabrir o ticket" },
  dialogo: { titulo: "Pergunta", marca: "pergunta", acao: "Responder" },
  conversa: { titulo: "Conversa", marca: "responder", acao: "Responder" },
};

/** As colunas do board, na ordem do processo; as de gate ficam hachuradas e marcadas "gate". */
const COLUNAS: readonly (readonly [ColunaDoBoard, string])[] = [
  ["registro", "Registro"],
  ["aprovacao_demanda", "Aprovação da demanda"],
  ["planejamento", "Planejamento"],
  ["aprovacao_planejamento", "Aprovação do planejamento"],
  ["desenvolvimento", "Desenvolvimento"],
  ["revisao", "Revisão da rodada"],
  ["encerramento", "Encerramento da rodada"],
  ["aprovacao_pull_request", "Aprovação do PR"],
  ["sessao", "Ajustes do PR"],
  ["revisao_demanda", "Revisão da demanda"],
  ["encerramento_demanda", "Encerramento da demanda"],
];
const GATES: ReadonlySet<ColunaDoBoard> = new Set([
  "aprovacao_demanda",
  "aprovacao_planejamento",
  "aprovacao_pull_request",
]);

/** As 5 etapas do processo sobre as colunas do board, com quantas colunas cada uma agrupa. */
const ETAPAS_DO_PROCESSO: readonly (readonly [string, number])[] = [
  ["Registrar", 2],
  ["Planejar", 2],
  ["Implementar", 1],
  ["Revisar", 1],
  ["Encerrar", 5],
];

/** A etapa do ticket em minúsculas, no meio da frase. */
const nomeDaEtapa = (etapa: keyof typeof ETAPA_DO_TICKET): string => ETAPA_DO_TICKET[etapa].toLowerCase();

/** O endereço do que a espera ou a sessão trata: a rodada, quando é de uma, ou a demanda. */
const enderecoDe = (x: { demanda: string; rodada?: string }): string => x.rodada ?? x.demanda;

/** O texto escapado com cada endereço (I-206, I-206.R1, I-206.T3) inteiro, que não quebra no hífen. */
const comEnderecosInteiros = (texto: string): string =>
  escapar(texto).replaceAll(/\bI-\d+(?:\.[RT]\d+)?\b/g, '<span class="endereco">$&</span>');

/** A frase do que falta para a espera acabar. */
function fraseDoQueFalta(e: EsperaDoAuditor): string {
  const pr = e.pr ? `PR #${e.pr.id}` : "PR";
  switch (e.motivo) {
    case "gate_demanda":
      return "Registro enviado; falta aprovar";
    case "gate_planejamento":
      return "Plano enviado; falta aprovar";
    case "gate_pr":
      return `${pr} aberto; aguarda a sua revisão no PR`;
    case "ajustes":
      return `${pr} reprovado; converse com o agente sobre os ajustes`;
    case "falha":
      return e.erro ?? "o agente falhou";
    case "dialogo":
      return e.pergunta === undefined ? "O agente abriu uma pergunta" : `O agente pergunta: ${e.pergunta}`;
    default:
      return "O agente respondeu e espera você";
  }
}

/** Cartão do que aguarda o Auditor; o cartão inteiro abre o chat da sessão ou a página da demanda, onde se decide. */
function cartaoDaEspera(e: EsperaDoAuditor, agora: Date): string {
  const motivo = MOTIVOS[e.motivo];
  const falhou = e.motivo === "falha";
  const destino = e.sessao === undefined ? caminhoDaDemanda(e.demanda) : caminhoDaSessao(e.sessao);
  const ticket = e.ticket
    ? `<span class="mono">${escapar(e.ticket.ref)}</span> · ${nomeDaEtapa(e.ticket.etapa)}${e.ticket.modo ? ` · ${MODO_DA_SESSAO[e.ticket.modo]}` : ""} · `
    : "";
  return `<a class="decisao superficie${falhou ? " falha" : ""}" href="${destino}">
    <span class="decisao-motivo">${motivo.titulo}</span><span class="btn${falhou ? "" : " btn-primario"} btn-pequeno">${motivo.acao} →</span>
    <span class="decisao-titulo"><span class="id">${escapar(enderecoDe(e))}</span> ${escapar(e.titulo)}</span>
    <p class="decisao-texto">${escapar(fraseDoQueFalta(e))}</p>
    <div class="decisao-pe"><span class="tag">${escapar(e.projeto)}</span><span>${ticket}${ha(e.desde, agora)}</span></div>
  </a>`;
}

/** Linha de uma sessão rodando: o que o agente faz, como o processo vivo diz; sem ele, o título ou a etapa do ticket. */
function linhaDaSessaoRodando(s: SessaoRodando, agora: Date): string {
  return `<a class="rodando-linha" href="${caminhoDaSessao(s.sessao)}">
    <span class="pill pill-rodando">${MODO_DA_SESSAO[s.modo]}</span>
    <span class="id">${escapar(s.demanda)}</span>
    <span class="titulo">${escapar(s.titulo)} <span class="muted">— ${escapar(s.fazendo ?? ETAPA_DO_TICKET[s.etapa])}</span></span>
    <span class="muted esconde"><span class="mono">${escapar(s.ticket)}</span> · ${nomeDaEtapa(s.etapa)}</span>
    ${rotuloDoModelo(s.modelo ? nomeDoModelo(s.modelo) : "padrão do pi")}
    <span class="tempo muted">${ha(s.desde, agora)}</span>
  </a>`;
}

/** As marcas do cartão, em HTML (cada uma num texto só, que quebra entre as palavras) e sem repetir: em execução, aguarda você e bloqueada por I-x (que não quebra no hífen). */
function marcasDoCartao(c: CartaoDoBoard, dados: DadosDoInicio, agora: Date) {
  const marcas = new Map<string, [classe: string, pill: string]>();
  for (const s of dados.rodando.filter((x) => enderecoDe(x) === c.ref)) {
    // No cartão estreito a marca quebra entre as palavras; da duração do `ha()`, só "menos de" se separa do "1 min".
    const duracao = ha(s.desde, agora).replace("há ", "").replace("menos\u00a0de\u00a0", "menos de ");
    marcas.set(`em execução · ${duracao}`, ["rodando", "pill-rodando"]);
  }
  for (const e of dados.aguarda.filter((x) => enderecoDe(x) === c.ref)) {
    marcas.set(`aguarda você · ${MOTIVOS[e.motivo].marca}`, [
      "aguarda",
      e.motivo === "falha" ? "pill-falha" : "pill-aguarda",
    ]);
  }
  if (c.bloqueios.length > 0) {
    const predecessoras = c.bloqueios.map((id) => `<span class="mono">${escapar(id)}</span>`).join(", ");
    marcas.set(`bloqueada por ${predecessoras}`, ["bloqueada", "pill-neutro"]);
  }
  return [...marcas];
}

function cartaoDoBoard(c: CartaoDoBoard, dados: DadosDoInicio, agora: Date): string {
  const marcas = marcasDoCartao(c, dados, agora);
  const classes = ["cartao", ...new Set(marcas.map(([, [classe]]) => classe))].join(" ");
  const pills = marcas.map(([html, [, pill]]) => `<span class="pill ${pill}"><span>${html}</span></span>`).join("");
  const t = c.ticket;
  const mais = c.outros > 0 ? ` (+${String(c.outros)})` : "";
  return `<a class="${classes}" href="${caminhoDaDemanda(c.demanda)}">
    <div class="cartao-topo"><span class="id">${escapar(c.ref)}</span><span class="tag">${escapar(c.projeto)}</span></div>
    <div class="cartao-titulo">${comEnderecosInteiros(c.titulo)}</div>
    ${t ? `<div class="cartao-ticket"><span class="mono">${escapar(t.ref)}</span> ${nomeDaEtapa(t.etapa)}${t.modo ? ` · ${MODO_DA_SESSAO[t.modo]}` : ""} · ${STATUS_DO_TICKET[t.status]}${mais}</div>` : ""}
    ${marcas.length > 0 ? `<div class="cartao-marcas">${pills}</div>` : ""}
  </a>`;
}

/** Board: uma coluna por fase, agrupadas sob as 5 etapas; as de gate hachuradas e marcadas "gate". */
function colunasDoBoard(dados: DadosDoInicio, agora: Date): string {
  const coluna = ([chave, nome]: readonly [ColunaDoBoard, string]) => {
    const cartoes = dados.board.filter((c) => c.coluna === chave);
    const gate = GATES.has(chave);
    return `<div class="coluna${gate ? " coluna-gate" : ""}">
      <div class="coluna-cabeca">${nome} <span class="n">${String(cartoes.length)}</span>${gate ? ' <span class="tag tag-gate">gate</span>' : ""}</div>
      <div class="coluna-corpo">${cartoes.map((c) => cartaoDoBoard(c, dados, agora)).join("") || '<span class="coluna-vazia">vazia</span>'}</div>
    </div>`;
  };
  return (
    ETAPAS_DO_PROCESSO.map(
      ([nome, colunas]) => `<div class="etapa" style="grid-column: span ${String(colunas)}">${nome}</div>`,
    ).join("") + COLUNAS.map(coluna).join("")
  );
}

/** A página `/home`: a frase do mês, Aguarda você (da espera mais antiga para a mais nova), Rodando e o board. */
export function inicio(dados: DadosDoInicio, agora: Date): string {
  const { aguarda, rodando } = dados;
  return `<div class="cabeca-pagina"><h1>Início</h1></div>
  ${fraseDoMes(dados.mes)}
  <section class="bloco bloco-aguarda" aria-labelledby="titulo-aguarda">
    <div class="secao-titulo"><h2 id="titulo-aguarda">Aguarda você</h2>${aguarda.length > 0 ? `<span class="contador">${String(aguarda.length)}</span><span class="muted">da mais antiga para a mais nova</span>` : ""}</div>
    ${aguarda.length > 0 ? `<div class="decisoes">${aguarda.map((e) => cartaoDaEspera(e, agora)).join("")}</div>` : '<p class="muted vazio">Nada aguarda você agora.</p>'}
  </section>
  <section class="bloco bloco-rodando" aria-labelledby="titulo-rodando">
    <div class="secao-titulo"><h2 id="titulo-rodando">Rodando</h2><span class="muted">${String(rodando.length)}</span></div>
    ${rodando.length > 0 ? `<div class="rodando-linhas superficie">${rodando.map((s) => linhaDaSessaoRodando(s, agora)).join("")}</div>` : '<p class="muted vazio">Nenhuma sessão rodando.</p>'}
  </section>
  <section class="bloco" aria-labelledby="titulo-board">
    <div class="secao-titulo"><h2 id="titulo-board">Board</h2><span class="muted">${plural(dados.emAndamento, "demanda", "demandas")} em andamento</span></div>
    <div class="board-etapas">${colunasDoBoard(dados, agora)}</div>
  </section>`;
}
