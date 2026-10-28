// Quadro de demandas (comparacao-sdlc §9.1) como função pura que devolve HTML: o trabalho global ativo e um cartão por
// demanda, com as rodadas, o que espera o Auditor e o que bloqueia. O texto que vem do servidor passa por `escapar`.
import type { EtapaTicket, FaseDemanda, FaseRodada } from "../../../dominio/primitivos.ts";
import {
  caminhoDaDemanda,
  escapar,
  FASE_DA_DEMANDA,
  FASE_DA_RODADA,
  PILULA_DO_STATUS,
  rotuloDoStatus,
} from "../render.ts";

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
export const ETAPA_DO_TICKET: Record<EtapaTicket, string> = {
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

export const pilula = ([rotulo, classe]: readonly [string, string]): string =>
  `<span class="pill ${classe}">${rotulo}</span>`;

const linkExterno = (url: string, texto: string): string =>
  /^https?:\/\//.test(url)
    ? `<a class="link" href="${escapar(url)}" target="_blank" rel="noopener">${texto} ↗</a>`
    : texto;

const rodada = (r: DemandaDoQuadro["rodadas"][number]): string => {
  const pr = r.pr ? ` ${linkExterno(r.pr.url, `PR #${escapar(r.pr.id)}`)}` : "";
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
    <a class="link dm-abrir" href="${caminhoDaDemanda(d.id)}">abrir a demanda →</a>
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

// ——— página da demanda (só leitura) ———

type StatusTicket = keyof typeof PILULA_DO_STATUS;
export interface DadosDaPagina {
  demanda: { id: string; projeto: string; titulo: string; fase: FaseDemanda };
  rodadas: { ref: string; titulo: string; fase: FaseRodada }[];
  tickets: {
    ref: string;
    etapa: EtapaTicket;
    status: StatusTicket;
    rodada?: string;
    titulo?: string;
    instrucao?: string;
    motivo_falha?: string;
  }[];
  decisoes: { ticket: string; resultado: "aprovado" | "recusado"; nota?: number; motivo?: string; por: string }[];
  evidencias: {
    tipo: string;
    rodada?: string;
    ticket?: string;
    dados: unknown;
    anexos: { nome: string; classe: string; link: string }[];
  }[];
  encerramento: {
    passos: { passo: "verificacao" | "pr" | "integracao"; feito: boolean }[];
    limpeza_pendente: string[];
    falha?: { etapa: "check_final" | "integracao" | "limpeza"; motivo: string };
  };
  dependencias: { demanda_id: string; fase: FaseDemanda }[];
}

/** O tipo da evidência como a página o mostra; o que não está aqui sai com a chave legível. */
const TIPO_DA_EVIDENCIA: Record<string, string> = {
  comportamento: "Comportamento",
  pr_aberto: "PR aberto",
  revisao_integral: "Revisão integral",
  plano: "Plano",
  execucao_testes: "Testes",
  matriz_fitness: "Fitness",
  relatorio_sonar: "SonarQube",
};
const tipoDaEvidencia = (tipo: string): string => TIPO_DA_EVIDENCIA[tipo] ?? tipo.replaceAll("_", " ");

const ESTADO_DO_PASSO = {
  feito: ["Feito", "pill-ok"],
  pendente: ["Pendente", "pill-neutro"],
  falhou: ["Falhou", "pill-falha"],
} as const;

type Pagina = DadosDaPagina;

/** A decisão do ticket: resultado, nota e motivo (CA-11). */
const decisao = (d: Pagina["decisoes"][number]): string =>
  `<li class="dm-decisao"><strong>${d.resultado === "aprovado" ? "Aprovado" : "Recusado"}</strong> por ${escapar(d.por)}${d.nota === undefined ? "" : ` · nota ${String(d.nota)}`}${d.motivo === undefined ? "" : `: ${escapar(d.motivo)}`}</li>`;

function ticket(t: Pagina["tickets"][number], decisoes: Pagina["decisoes"]): string {
  const minhas = decisoes.filter((d) => d.ticket === t.ref);
  return `<li class="dm-ticket">
    <div class="dm-linha"><span class="id">${escapar(t.ref)}</span> <span>${ETAPA_DO_TICKET[t.etapa]}</span> <span class="pill ${PILULA_DO_STATUS[t.status]}">${rotuloDoStatus(t.status)}</span></div>
    ${t.titulo === undefined ? "" : `<p class="dm-texto">${escapar(t.titulo)}</p>`}
    ${t.instrucao === undefined ? "" : `<p class="dm-texto"><strong>Instrução:</strong> ${escapar(t.instrucao)}</p>`}
    ${t.motivo_falha === undefined ? "" : `<p class="dm-texto dm-falha"><strong>Motivo da falha:</strong> ${escapar(t.motivo_falha)}</p>`}
    ${minhas.length > 0 ? `<ul class="dm-decisoes">${minhas.map(decisao).join("")}</ul>` : ""}
  </li>`;
}

/** O gate do PR da rodada (CA-20 a CA-23): aprovar com nota 1–5, ou reprovar com motivo e sem nota (D03). */
function gatePR(ref: string): string {
  const base = `/api/demandas/rodadas/${escapar(ref)}/pr`;
  const motivo = `motivo-${escapar(ref)}`;
  const nota = `nota-${escapar(ref)}`;
  const notas = [1, 2, 3, 4, 5].map((n) => `<option value="${String(n)}">${String(n)}</option>`).join("");
  return `<div class="dm-gate">
    <label for="${motivo}">Motivo (obrigatório para reprovar o PR)</label><textarea id="${motivo}" rows="3" aria-describedby="${motivo}-erro"></textarea><span class="msg-erro" id="${motivo}-erro" role="alert" hidden></span>
    <label for="${nota}">Nota (obrigatória para aprovar o PR)</label><select id="${nota}" aria-describedby="${nota}-erro"><option value="">Escolha a nota</option>${notas}</select>
    <div class="dm-botoes"><button type="button" class="btn btn-grande btn-reprovar" data-gate="false" data-caminho="${base}" data-campo="${motivo}">Reprovar PR</button><button type="button" class="btn btn-grande btn-primario" data-gate="true" data-caminho="${base}" data-nota="${nota}">Aprovar PR</button></div>
    <span class="msg-erro" id="${nota}-erro" role="alert" hidden></span>
  </div>`;
}

function rodadaDaPagina(r: Pagina["rodadas"][number], p: Pagina): string {
  const meus = p.tickets.filter((t) => t.rodada === r.ref);
  const encerra = meus.findLast((t) => t.etapa === "encerrar_rodada");
  const nota = p.decisoes.findLast((d) => d.ticket === encerra?.ref && d.resultado === "aprovado")?.nota;
  const pr = p.evidencias.findLast((e) => e.tipo === "pr_aberto" && e.ticket === encerra?.ref)?.dados as
    { id: string; url: string } | undefined;
  return `<section class="bloco dm-rodada" id="${escapar(r.ref)}" aria-labelledby="titulo-${escapar(r.ref)}">
    <div class="secao-titulo"><h2 id="titulo-${escapar(r.ref)}"><span class="id">${escapar(r.ref)}</span> ${escapar(r.titulo)}</h2></div>
    <div class="dm-linha">${pilula(FASE_DA_RODADA[r.fase])}${nota === undefined ? "" : ` <span class="tag">nota ${String(nota)}</span>`}${pr === undefined ? "" : ` ${linkExterno(pr.url, `PR #${escapar(pr.id)}`)}`}</div>
    ${r.fase === "aprovacao_pull_request" ? gatePR(r.ref) : ""}
    ${r.fase === "sessao" ? `<p class="dm-texto"><a class="link" href="/api/demandas/rodadas/${escapar(r.ref)}/ajustes">Sessão de ajustes de ${escapar(r.ref)}</a></p>` : ""}
    ${meus.length > 0 ? `<ul class="dm-tickets">${meus.map((t) => ticket(t, p.decisoes)).join("")}</ul>` : '<p class="muted vazio">Sem tickets.</p>'}
  </section>`;
}

const secao = (id: string, titulo: string, corpo: string): string =>
  `<section class="bloco" aria-labelledby="${id}"><div class="secao-titulo"><h2 id="${id}">${titulo}</h2></div>${corpo}</section>`;

function evidencia(e: Pagina["evidencias"][number]): string {
  const dono = e.ticket ?? e.rodada ?? "demanda";
  const anexos = e.anexos.map(
    (a) =>
      `<li><a class="link" href="${escapar(a.link)}" target="_blank" rel="noopener"${a.classe === "imagem" ? ` data-imagem="${escapar(a.nome)}"` : ""}>${escapar(a.nome)}</a></li>`,
  );
  return `<li class="dm-evidencia">
    <div class="dm-linha"><strong>${escapar(tipoDaEvidencia(e.tipo))}</strong> <span class="id">${escapar(dono)}</span></div>
    ${anexos.length > 0 ? `<ul class="dm-anexos">${anexos.join("")}</ul>` : ""}
    <details><summary>dados</summary><pre class="dm-dados">${escapar(JSON.stringify(e.dados, null, 2))}</pre></details>
  </li>`;
}

/** O encerramento final (CA-12): só com progresso; integração feita e limpeza falha nunca viram "nada integrado". */
function encerramento({ passos, limpeza_pendente: pendentes, falha }: Pagina["encerramento"]): string {
  const feito = (nome: string) => passos.find((p) => p.passo === nome)?.feito === true;
  if (!passos.some((p) => p.feito) && !falha && pendentes.length === 0) return "";
  const limpezaFalhou = falha?.etapa === "limpeza" || pendentes.length > 0;
  const estados: [string, keyof typeof ESTADO_DO_PASSO][] = [
    ["Verificação", feito("verificacao") ? "feito" : falha?.etapa === "check_final" ? "falhou" : "pendente"],
    ["PR final", feito("pr") ? "feito" : "pendente"],
    ["Integração", feito("integracao") ? "feito" : falha?.etapa === "integracao" ? "falhou" : "pendente"],
    ["Limpeza", limpezaFalhou ? "falhou" : feito("integracao") ? "feito" : "pendente"],
  ];
  const itens = estados.map(([nome, estado]) => {
    const motivo =
      estado === "falhou" && falha && (nome === "Limpeza") === (falha.etapa === "limpeza") ? falha : undefined;
    const detalhe = [
      ...(motivo ? [escapar(motivo.motivo)] : []),
      ...(nome === "Limpeza" && pendentes.length > 0 ? [`pendente: ${pendentes.map(escapar).join(", ")}`] : []),
    ];
    return `<li class="dm-passo"><strong>${nome}</strong> ${pilula(ESTADO_DO_PASSO[estado])}${detalhe.length > 0 ? ` <span class="dm-texto">${detalhe.join(" · ")}</span>` : ""}</li>`;
  });
  const resumo =
    feito("integracao") && limpezaFalhou
      ? '<p class="dm-texto dm-falha">Integração concluída. Limpeza falhou: o código já foi integrado, só a limpeza precisa de atenção.</p>'
      : "";
  return secao("titulo-encerramento", "Encerramento final", `${resumo}<ul class="dm-passos">${itens.join("")}</ul>`);
}

/** Os gates que a fase pede: a rota da decisão e os rótulos dos dois botões. */
const GATES: Partial<Record<FaseDemanda, { titulo: string; rota: string; aprovar: string; recusar: string }>> = {
  aprovacao_demanda: { titulo: "Decisão da demanda", rota: "decisao", aprovar: "Aprovar", recusar: "Recusar" },
  aprovacao_planejamento: {
    titulo: "Decisão do planejamento",
    rota: "planejamento/decisao",
    aprovar: "Aprovar planejamento",
    recusar: "Reprovar planejamento",
  },
};

/** O formulário do gate da fase atual (CA-14 a CA-19); fora de um gate, nada. O motivo só vale para recusar. */
function gate({ id, fase }: Pagina["demanda"]): string {
  const g = GATES[fase];
  if (!g) return "";
  const campo = `motivo-${g.rota.replaceAll("/", "-")}`;
  const botao = (aprovado: boolean, rotulo: string) =>
    `<button type="button" class="btn btn-grande ${aprovado ? "btn-primario" : "btn-reprovar"}" data-gate="${String(aprovado)}" data-caminho="/api/demandas/${escapar(id)}/${g.rota}" data-campo="${campo}">${rotulo}</button>`;
  return secao(
    "titulo-gate",
    g.titulo,
    `<div class="dm-gate"><label for="${campo}">Motivo (obrigatório para ${g.recusar.toLowerCase()})</label><textarea id="${campo}" rows="3" aria-describedby="${campo}-erro"></textarea><span class="msg-erro" id="${campo}-erro" role="alert" hidden></span><div class="dm-botoes">${botao(false, g.recusar)}${botao(true, g.aprovar)}</div></div>`,
  );
}

export function pagina(p: DadosDaPagina): string {
  const { demanda: d } = p;
  const globais = p.tickets.filter((t) => t.rodada === undefined);
  return `<a class="link" href="/demandas">← Demandas</a>
  <div class="cabeca-pagina dm-cabeca"><h1>${escapar(d.titulo)}</h1>
    <div class="dm-linha"><span class="id">${escapar(d.id)}</span><span class="tag">${escapar(d.projeto)}</span>${pilula(FASE_DA_DEMANDA[d.fase])}</div></div>
  ${gate(d)}
  ${
    p.dependencias.length > 0
      ? secao(
          "titulo-dependencias",
          "Dependências",
          `<ul class="dm-tickets">${p.dependencias.map((x) => `<li class="dm-linha"><a class="link id" href="${caminhoDaDemanda(x.demanda_id)}">${escapar(x.demanda_id)}</a> ${pilula(FASE_DA_DEMANDA[x.fase])}</li>`).join("")}</ul>`,
        )
      : ""
  }
  ${p.rodadas.map((r) => rodadaDaPagina(r, p)).join("")}
  ${globais.length > 0 ? secao("titulo-globais", "Tickets globais", `<ul class="dm-tickets">${globais.map((t) => ticket(t, p.decisoes)).join("")}</ul>`) : ""}
  ${p.evidencias.length > 0 ? secao("titulo-evidencias", "Evidências", `<ul class="dm-tickets">${p.evidencias.map(evidencia).join("")}</ul>`) : ""}
  ${encerramento(p.encerramento)}`;
}
