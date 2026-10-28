// Quadro de demandas (comparacao-sdlc §9.1) como função pura que devolve HTML: o trabalho global ativo e um cartão por
// demanda, com as rodadas, o que espera o Auditor e o que bloqueia. O texto que vem do servidor passa por `escapar`.
import type { EtapaTicket, FaseDemanda, FaseRodada } from "../../../dominio/primitivos.ts";
import { escapar, FASE_DA_DEMANDA, FASE_DA_RODADA } from "../render.ts";

export interface DemandaDoQuadro {
  id: string;
  projeto: string;
  titulo: string;
  fase: FaseDemanda;
  rodadas: { ref: string; fase: FaseRodada; pr?: { id: string; url: string } }[];
  bloqueios: { demanda_id: string; fase: FaseDemanda }[];
  falhos: { ref: string; etapa: EtapaTicket }[];
}
export interface DadosDoQuadro {
  demandas: DemandaDoQuadro[];
  trabalho: { ref: string; etapa: EtapaTicket; rodada?: string }[];
}

/** A etapa do ticket como o quadro a mostra. */
const ETAPA_DO_TICKET: Record<EtapaTicket, string> = {
  demanda: "Demanda",
  planejar: "Planejamento",
  implementar: "Implementação",
  revisar_rodada: "Revisão da rodada",
  encerrar_rodada: "Encerramento da rodada",
  sessao_em_aberto: "Sessão em aberto",
  revisar_demanda: "Revisão da demanda",
  encerrar_demanda: "Encerramento da demanda",
  resolver_conflito: "Resolução de conflito",
};

const pilula = ([rotulo, classe]: [string, string]): string => `<span class="pill ${classe}">${rotulo}</span>`;

const rodada = (r: DemandaDoQuadro["rodadas"][number]): string => {
  const pr = r.pr
    ? ` <a class="link" href="${escapar(r.pr.url)}" target="_blank" rel="noopener">PR #${escapar(r.pr.id)} ↗</a>`
    : "";
  return `<li><span class="id">${escapar(r.ref)}</span> ${pilula(FASE_DA_RODADA[r.fase])}${pr}</li>`;
};

function cartao(d: DemandaDoQuadro, todas: readonly DemandaDoQuadro[]): string {
  const aguarda =
    d.fase === "aprovacao_demanda" ||
    d.fase === "aprovacao_planejamento" ||
    d.rodadas.some((r) => r.fase === "aprovacao_pull_request");
  const marcas = [
    ...(aguarda ? [`<span class="pill pill-aguarda">aguarda a decisão do Auditor</span>`] : []),
    ...d.falhos.map((f) => `<span class="pill pill-falha">ticket falho ${escapar(f.ref)}</span>`),
    ...d.bloqueios.map((b) => {
      const titulo = todas.find((o) => o.id === b.demanda_id)?.titulo;
      const partes = [b.demanda_id, ...(titulo === undefined ? [] : [titulo]), FASE_DA_DEMANDA[b.fase][0]];
      return `<span class="pill pill-neutro">aguarda ${partes.map(escapar).join(" · ")}</span>`;
    }),
  ];
  return `<article class="cartao dm-cartao${aguarda ? " aguarda" : ""}">
    <div class="cartao-topo"><span class="id">${escapar(d.id)}</span><span class="tag">${escapar(d.projeto)}</span></div>
    <h3 class="cartao-titulo">${escapar(d.titulo)}</h3>
    <div>${pilula(FASE_DA_DEMANDA[d.fase])}</div>
    ${d.rodadas.length > 0 ? `<ul class="dm-rodadas">${d.rodadas.map(rodada).join("")}</ul>` : ""}
    ${marcas.length > 0 ? `<div class="cartao-marcas">${marcas.join("")}</div>` : ""}
    <a class="link dm-abrir" href="/demandas/${encodeURIComponent(d.id)}">abrir a demanda →</a>
  </article>`;
}

export function quadro({ demandas, trabalho }: DadosDoQuadro): string {
  const ativo = trabalho.map(
    (t) =>
      `<li><span class="id">${escapar(t.ref)}</span> ${ETAPA_DO_TICKET[t.etapa]}${t.rodada === undefined ? "" : ` · rodada <span class="id">${escapar(t.rodada)}</span>`}</li>`,
  );
  return `<div class="cabeca-pagina"><h1>Demandas</h1></div>
  <section class="bloco bloco-aguarda" aria-labelledby="titulo-trabalho">
    <div class="secao-titulo"><h2 id="titulo-trabalho">Trabalho ativo</h2></div>
    ${ativo.length > 0 ? `<ul class="dm-trabalho">${ativo.join("")}</ul>` : '<p class="muted vazio">Não há trabalho em andamento.</p>'}
  </section>
  <section class="bloco" aria-labelledby="titulo-demandas">
    <div class="secao-titulo"><h2 id="titulo-demandas">Demandas</h2></div>
    ${demandas.length > 0 ? `<div class="dm-grade">${demandas.map((d) => cartao(d, demandas)).join("")}</div>` : '<p class="muted vazio">Nenhuma demanda em andamento.</p>'}
  </section>`;
}
