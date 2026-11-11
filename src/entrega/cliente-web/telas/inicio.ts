// Início (F7 §4.4; comparacao-sdlc §9.1) como funções puras: a frase do mês, o que aguarda o Auditor, o que roda e o
// board das demandas em andamento, com as colunas por estado da demanda e, na execução, por estado da rodada. O DOM e a
// rede ficam em inicio-montar.ts.
import type { NomeGate } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import type { CartaoDoBoard, ColunaDoBoard, DadosDoInicio, SessaoRodando } from "../../contrato/inicio.ts";
import type { PendenciaDoInicio } from "../../contrato/demanda.ts";
import type { TipoPendencia } from "../../../sdlc/nucleo/demanda/pendencia.ts";
import type { MotivoDeRecusaEmJson, RecusaDoDespacho } from "../../contrato/despacho.ts";
import {
  caminhoDaDemanda,
  caminhoDaSessao,
  escapar,
  ha,
  MODO_DA_SESSAO,
  nomeDoModelo,
  plural,
  rotuloDoModelo,
  nomeDoEstadoDoTicket,
} from "../render.ts";
import { ROTULO_DA_ETAPA, faseDoProcesso } from "../rotulos.ts";
import { fraseDoMes } from "./metricas.ts";

/** Cada tipo de Pendência: o título do cartão, a marca no board e o botão que leva aonde se resolve. */
/** @testes o teste confere os seis tipos; as outras telas das Pendências o importam */
export const ROTULO_DO_TIPO_DE_PENDENCIA: Record<TipoPendencia, { titulo: string; marca: string; acao: string }> = {
  gate_humano: { titulo: "Gate", marca: "gate", acao: "Decidir" },
  item_bloqueado: { titulo: "Bloqueado", marca: "bloqueado", acao: "Reabrir o ticket" },
  dialogo_do_agente: { titulo: "Diálogo do agente", marca: "diálogo", acao: "Responder" },
  revisao_parada: { titulo: "Revisão parada", marca: "revisão parada", acao: "Ver a demanda" },
  acao_externa: { titulo: "Ação externa", marca: "ação externa", acao: "Integrar o PR" },
  despacho_parado: { titulo: "Despacho parado", marca: "despacho parado", acao: "Executar" },
};

/** O que aparece em vermelho: o item bloqueado e a revisão integral parada. */
export const EM_ALERTA: ReadonlySet<TipoPendencia> = new Set(["item_bloqueado", "revisao_parada"]);

const ROTULO_DO_GATE: Record<NomeGate, string> = {
  gate_demanda: "aprovação da demanda",
  gate_planejamento: "aprovação do planejamento",
  gate_pr: "aprovação do PR",
  gate_revisao_rodada: "revisão da rodada",
  gate_revisao_demanda: "revisão da demanda",
};

/** O texto de cada tipo de `MotivoDeRecusa`: por que o item não foi despachado. O `tsc` exige os seis tipos. */
const ROTULO_DO_MOTIVO_DE_RECUSA: {
  [Tipo in MotivoDeRecusaEmJson["tipo"]]: (motivo: Extract<MotivoDeRecusaEmJson, { tipo: Tipo }>) => string;
} = {
  limite_de_paralelismo: (m) => `Limite de paralelismo cheio: ${String(m.em_uso)} de ${String(m.limite)} em uso`,
  dependencia_pendente: (m) => `Aguarda ${m.aguarda.join(", ")}`,
  gate_aguardando: (m) => `Aguarda a ${ROTULO_DO_GATE[m.gate]}`,
  ocupado: (m) => `Ocupado por ${m.por}`,
  bloqueado: (m) => `Bloqueado: ${m.motivo}`,
  aguarda_acao_externa: () => "Aguarda o merge do PR na plataforma",
};

/** O motivo da recusa em texto puro; quem o põe no HTML o escapa. */
export const textoDoMotivoDeRecusa = (motivo: MotivoDeRecusaEmJson): string =>
  (ROTULO_DO_MOTIVO_DE_RECUSA[motivo.tipo] as (m: MotivoDeRecusaEmJson) => string)(motivo);

/** As colunas do board, na ordem do processo; as de gate ficam hachuradas e marcadas "gate". */
const COLUNAS: readonly (readonly [ColunaDoBoard, string])[] = [
  ["entender_e_desenhar", "Registro"],
  ["gate_demanda", "Aprovação da demanda"],
  ["planejar", "Planejamento"],
  ["gate_planejamento", "Aprovação do planejamento"],
  ["implementar", "Desenvolvimento"],
  ["revisar_rodada", "Revisão da rodada"],
  ["encerrar_rodada", "Encerramento da rodada"],
  ["gate_pr", "Aprovação do PR"],
  ["ajustar_resultado", "Ajustes do PR"],
  ["revisar_demanda", "Revisão da demanda"],
  ["encerramento_demanda", "Encerramento da demanda"],
];
const GATES: ReadonlySet<ColunaDoBoard> = new Set(["gate_demanda", "gate_planejamento", "gate_pr"]);

/** As 5 etapas do processo sobre as colunas do board, com quantas colunas cada uma agrupa. */
const FASES_DO_PROCESSO: readonly (readonly [EtapaTicket, number])[] = [
  ["entender_e_desenhar", 2],
  ["planejar", 2],
  ["implementar", 1],
  ["revisar_rodada", 1],
  ["encerrar_rodada", 5],
];

/** A etapa do ticket em minúsculas, no meio da frase. */
const nomeDaEtapa = (etapa: EtapaTicket): string => ROTULO_DA_ETAPA[etapa].toLowerCase();

/** O endereço do que a Pendência ou a sessão trata: a rodada, quando é de uma, ou a demanda. */
const enderecoDe = (x: { demanda: string; rodada?: string }): string => x.rodada ?? x.demanda;

/** O texto escapado com cada endereço (I-206, I-206.R1, I-206.T3) inteiro, que não quebra no hífen. */
const comEnderecosInteiros = (texto: string): string =>
  escapar(texto).replaceAll(/\bI-\d+(?:\.[RT]\d+)?\b/g, '<span class="endereco">$&</span>');

/** Cartão de uma Pendência; o cartão inteiro abre o chat da sessão ou a página da demanda, onde se resolve. */
function cartaoDaPendencia(p: PendenciaDoInicio, agora: number): string {
  const rotulo = ROTULO_DO_TIPO_DE_PENDENCIA[p.tipo];
  const emAlerta = EM_ALERTA.has(p.tipo);
  const destino = p.sessao === undefined ? caminhoDaDemanda(p.demanda) : caminhoDaSessao(p.sessao);
  const ticket = p.item.includes(".T") ? `<span class="mono">${escapar(p.item)}</span> · ` : "";
  return `<a class="decisao superficie${emAlerta ? " falha" : ""}" href="${destino}">
    <span class="decisao-motivo">${rotulo.titulo}</span><span class="btn${emAlerta ? "" : " btn-primario"} btn-pequeno">${rotulo.acao} →</span>
    <span class="decisao-titulo"><span class="id">${escapar(enderecoDe(p))}</span> ${escapar(p.titulo)}</span>
    <p class="decisao-texto">${escapar(p.motivo)}</p>
    <div class="decisao-pe"><span class="tag">${escapar(p.projeto)}</span><span>${ticket}${ha(p.desde, agora)}</span></div>
  </a>`;
}

/** Linha de uma sessão rodando: o que o agente faz, como o processo vivo diz; sem ele, o título ou a etapa do ticket. */
function linhaDaSessaoRodando(s: SessaoRodando, agora: number): string {
  return `<a class="rodando-linha" href="${caminhoDaSessao(s.sessao)}">
    <span class="pill pill-rodando">${MODO_DA_SESSAO[s.modo]}</span>
    <span class="id">${escapar(s.demanda)}</span>
    <span class="titulo">${escapar(s.titulo)} <span class="muted">— ${escapar(s.fazendo ?? ROTULO_DA_ETAPA[s.etapa])}</span></span>
    <span class="muted esconde"><span class="mono">${escapar(s.ticket)}</span> · ${nomeDaEtapa(s.etapa)}</span>
    ${rotuloDoModelo(s.modelo ? nomeDoModelo(s.modelo) : "padrão do pi")}
    <span class="tempo muted">${ha(s.desde, agora)}</span>
  </a>`;
}

/** Linha de um item parado: o ticket e o motivo de o Despacho não o ter despachado; abre a página da demanda. */
function linhaDoItemParado({ item, motivo }: RecusaDoDespacho): string {
  const demanda = item.slice(0, item.indexOf(".T"));
  return `<a class="rodando-linha" href="${caminhoDaDemanda(demanda)}">
    <span class="pill pill-neutro">parado</span>
    <span class="id">${escapar(demanda)}</span>
    <span class="titulo"><span class="mono">${escapar(item)}</span> — ${escapar(textoDoMotivoDeRecusa(motivo))}</span>
  </a>`;
}

/** As marcas do cartão, em HTML (cada uma num texto só, que quebra entre as palavras) e sem repetir: em execução, aguarda você e bloqueada por I-x (que não quebra no hífen). */
function marcasDoCartao(c: CartaoDoBoard, dados: DadosDoInicio, agora: number) {
  const marcas = new Map<string, [classe: string, pill: string]>();
  for (const s of dados.rodando.filter((x) => enderecoDe(x) === c.ref)) {
    // No cartão estreito a marca quebra entre as palavras; da duração do `ha()`, só "menos de" se separa do "1 min".
    const duracao = ha(s.desde, agora).replace("há ", "").replace("menos\u00a0de\u00a0", "menos de ");
    marcas.set(`em execução · ${duracao}`, ["rodando", "pill-rodando"]);
  }
  for (const e of dados.aguarda.filter((x) => enderecoDe(x) === c.ref)) {
    marcas.set(`aguarda você · ${ROTULO_DO_TIPO_DE_PENDENCIA[e.tipo].marca}`, [
      "aguarda",
      EM_ALERTA.has(e.tipo) ? "pill-falha" : "pill-aguarda",
    ]);
  }
  if (c.bloqueios.length > 0) {
    const predecessoras = c.bloqueios.map((id) => `<span class="mono">${escapar(id)}</span>`).join(", ");
    marcas.set(`bloqueada por ${predecessoras}`, ["bloqueada", "pill-neutro"]);
  }
  return [...marcas];
}

function cartaoDoBoard(c: CartaoDoBoard, dados: DadosDoInicio, agora: number): string {
  const marcas = marcasDoCartao(c, dados, agora);
  const classes = ["cartao", ...new Set(marcas.map(([, [classe]]) => classe))].join(" ");
  const pills = marcas.map(([html, [, pill]]) => `<span class="pill ${pill}"><span>${html}</span></span>`).join("");
  const t = c.ticket;
  const mais = c.outros > 0 ? ` (+${String(c.outros)})` : "";
  return `<a class="${classes}" href="${caminhoDaDemanda(c.demanda)}">
    <div class="cartao-topo"><span class="id">${escapar(c.ref)}</span><span class="tag">${escapar(c.projeto)}</span></div>
    <div class="cartao-titulo">${comEnderecosInteiros(c.titulo)}</div>
    ${t ? `<div class="cartao-ticket"><span class="mono">${escapar(t.ref)}</span> ${nomeDaEtapa(t.etapa)}${t.modo ? ` · ${MODO_DA_SESSAO[t.modo]}` : ""} · ${nomeDoEstadoDoTicket(t.estado, t.pi_ativo)}${mais}</div>` : ""}
    ${marcas.length > 0 ? `<div class="cartao-marcas">${pills}</div>` : ""}
  </a>`;
}

/** Board: uma coluna por estado, agrupadas sob as 5 etapas; as de gate hachuradas e marcadas "gate". */
function colunasDoBoard(dados: DadosDoInicio, agora: number): string {
  const coluna = ([chave, nome]: readonly [ColunaDoBoard, string]) => {
    const cartoes = dados.board.filter((c) => c.coluna === chave);
    const gate = GATES.has(chave);
    return `<div class="coluna${gate ? " coluna-gate" : ""}">
      <div class="coluna-cabeca">${nome} <span class="n">${String(cartoes.length)}</span>${gate ? ' <span class="tag tag-gate">gate</span>' : ""}</div>
      <div class="coluna-corpo">${cartoes.map((c) => cartaoDoBoard(c, dados, agora)).join("") || '<span class="coluna-vazia">vazia</span>'}</div>
    </div>`;
  };
  return (
    FASES_DO_PROCESSO.map(
      ([etapa, colunas]) =>
        `<div class="etapa" style="grid-column: span ${String(colunas)}">${faseDoProcesso(etapa)}</div>`,
    ).join("") + COLUNAS.map(coluna).join("")
  );
}

/** A página `/home`: a frase do mês, Aguarda você (da espera mais antiga para a mais nova), Rodando (com os itens parados) e o board. */
export function inicio(dados: DadosDoInicio, agora: number, recusas: readonly RecusaDoDespacho[]): string {
  const { aguarda, rodando } = dados;
  return `<div class="cabeca-pagina"><h1>Início</h1></div>
  ${fraseDoMes(dados.mes)}
  <section class="bloco bloco-aguarda" aria-labelledby="titulo-aguarda">
    <div class="secao-titulo"><h2 id="titulo-aguarda">Aguarda você</h2>${aguarda.length > 0 ? `<span class="contador">${String(aguarda.length)}</span><span class="muted">da mais antiga para a mais nova</span>` : ""}</div>
    ${aguarda.length > 0 ? `<div class="decisoes">${aguarda.map((p) => cartaoDaPendencia(p, agora)).join("")}</div>` : '<p class="muted vazio">Nada aguarda você agora.</p>'}
  </section>
  <section class="bloco bloco-rodando" aria-labelledby="titulo-rodando">
    <div class="secao-titulo"><h2 id="titulo-rodando">Rodando</h2><span class="muted">${String(rodando.length)}</span></div>
    ${rodando.length > 0 ? `<div class="rodando-linhas superficie">${rodando.map((s) => linhaDaSessaoRodando(s, agora)).join("")}</div>` : '<p class="muted vazio">Nenhuma sessão rodando.</p>'}
    ${recusas.length > 0 ? `<div class="rodando-linhas superficie">${recusas.map(linhaDoItemParado).join("")}</div>` : ""}
  </section>
  <section class="bloco" aria-labelledby="titulo-board">
    <div class="secao-titulo"><h2 id="titulo-board">Board</h2><span class="muted">${plural(dados.quantidadeEmAndamento, "demanda", "demandas")} em andamento</span></div>
    <div class="board-etapas">${colunasDoBoard(dados, agora)}</div>
  </section>`;
}
