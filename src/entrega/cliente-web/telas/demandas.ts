// Quadro de demandas (comparacao-sdlc §9.1) como função pura que devolve HTML: o trabalho global ativo e um cartão por
// demanda, com as rodadas, o que espera o Auditor e o que bloqueia. O texto que vem do servidor passa por `escapar`.
import type { EtapaTicket, EstadoDemanda, EstadoRodada } from "../../../nucleo/primitivos.ts";
import { markdown, markdownEmLinha } from "../markdown.ts";
import {
  caminhoDaDemanda,
  caminhoDaSessao,
  escapar,
  APARENCIA_DO_ESTADO_DA_DEMANDA,
  APARENCIA_DO_ESTADO_DA_RODADA,
  PILULA_DO_ESTADO_DO_TICKET,
  pilulaDoEstadoDoTicket,
  rotuloDoEstadoDoTicket,
} from "../render.ts";

/** @testes tipo que o teste usa para montar a entrada */
export interface DemandaDoQuadro {
  id: string;
  projeto: string;
  titulo: string;
  estado: EstadoDemanda;
  terminal: boolean;
  rodadas: { ref: string; estado: EstadoRodada; pr?: { id: string; url: string } }[];
  bloqueios: { demanda_id: string; estado: EstadoDemanda }[];
  falhos: { ref: string; etapa: EtapaTicket }[];
  /** O PR final verificado espera o humano integrá-lo na plataforma. */
  aguarda_merge: boolean;
}
export interface DadosDoQuadro {
  demandas: DemandaDoQuadro[];
  trabalho: { ref: string; etapa: EtapaTicket; rodada?: string; pi_ativo?: true }[];
}

/** A etapa do ticket como o quadro a mostra. */
export const ETAPA_DO_TICKET: Record<EtapaTicket, string> = {
  entender_e_desenhar: "Demanda",
  planejar: "Planejamento",
  implementar: "Implementação",
  revisar_rodada: "Revisão da rodada",
  encerrar_rodada: "Encerramento da rodada",
  ajustar_resultado: "Sessão em aberto",
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
  return `<li><span class="id">${escapar(r.ref)}</span> ${pilula(APARENCIA_DO_ESTADO_DA_RODADA[r.estado])}${pr}</li>`;
};

function cartao(d: DemandaDoQuadro, todas: readonly DemandaDoQuadro[]): string {
  const aguarda =
    d.estado === "gate_demanda" ||
    d.estado === "gate_planejamento" ||
    (!d.terminal && d.rodadas.some((r) => r.estado === "gate_pr"));
  const marcas = [
    ...(aguarda ? [`<span class="pill pill-aguarda">aguarda a decisão do Auditor</span>`] : []),
    ...(d.aguarda_merge ? [`<span class="pill pill-aguarda">aguarda o seu merge do PR final</span>`] : []),
    ...d.falhos.map((f) => `<span class="pill pill-falha">ticket falho ${escapar(f.ref)}</span>`),
    ...d.bloqueios.map((b) => {
      const titulo = todas.find((o) => o.id === b.demanda_id)?.titulo;
      const partes = [
        b.demanda_id,
        ...(titulo === undefined ? [] : [titulo]),
        APARENCIA_DO_ESTADO_DA_DEMANDA[b.estado][0],
      ];
      return `<span class="pill pill-neutro">aguarda ${partes.map(escapar).join(" · ")}</span>`;
    }),
  ];
  return `<article class="cartao dm-cartao${aguarda || d.aguarda_merge ? " aguarda" : ""}">
    <div class="cartao-topo"><span class="id">${escapar(d.id)}</span><span class="tag">${escapar(d.projeto)}</span></div>
    <h3 class="cartao-titulo">${escapar(d.titulo)}</h3>
    <div>${pilula(APARENCIA_DO_ESTADO_DA_DEMANDA[d.estado])}</div>
    ${d.rodadas.length > 0 ? `<ul class="dm-rodadas">${d.rodadas.map(rodada).join("")}</ul>` : ""}
    ${marcas.length > 0 ? `<div class="cartao-marcas">${marcas.join("")}</div>` : ""}
    <a class="link dm-abrir" href="${caminhoDaDemanda(d.id)}">abrir a demanda →</a>
  </article>`;
}

export function quadro({ demandas, trabalho }: DadosDoQuadro): string {
  const ativo = trabalho.map(
    (t) =>
      `<li><span class="id">${escapar(t.ref)}</span> ${ETAPA_DO_TICKET[t.etapa]}${t.rodada === undefined ? "" : ` · rodada <span class="id">${escapar(t.rodada)}</span>`} <span class="pill ${pilulaDoEstadoDoTicket("em_execucao", t.pi_ativo)}">${rotuloDoEstadoDoTicket("em_execucao", t.pi_ativo)}</span></li>`,
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

type EstadoTicket = keyof typeof PILULA_DO_ESTADO_DO_TICKET;
export interface DadosDaPagina {
  demanda: {
    id: string;
    projeto: string;
    titulo: string;
    tipo: string;
    descricao: string;
    estado: EstadoDemanda;
    terminal: boolean;
    arquivavel: boolean;
  };
  rodadas: { ref: string; titulo: string; estado: EstadoRodada }[];
  tickets: {
    ref: string;
    etapa: EtapaTicket;
    estado: EstadoTicket;
    satisfaz_dependencia: boolean;
    elegivel: boolean;
    sessao?: string;
    pi_ativo?: true;
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
    aguardando_merge?: { url: string };
  };
  dependencias: { demanda_id: string; estado: EstadoDemanda }[];
  dependentes: { demanda_id: string; titulo: string; estado: EstadoDemanda }[];
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
  arquivos_alterados: "Arquivos alterados",
  explicacao_fitness: "Explicação das fitness",
  comprovacao_criterios: "Comprovação dos critérios",
  criterios_aceite: "Critérios de aceite",
  desenho_solucao: "Desenho da solução",
  relatorio_impactos_arquitetura: "Impactos na arquitetura",
  custos_realizados: "Custos",
  prototipo: "Protótipo",
  relatorio_complexidade: "Complexidade",
  mensagem_pr: "Mensagem do PR",
  aula_codigo: "Aula do código",
  video_demonstracao: "Vídeo de demonstração",
  relatorio_produtividade: "Produtividade",
  testes_estresse: "Testes de estresse",
  analise_seguranca: "Análise de segurança",
};
const tipoDaEvidencia = (tipo: string): string => TIPO_DA_EVIDENCIA[tipo] ?? tipo.replaceAll("_", " ");

const ESTADO_DO_PASSO = {
  feito: ["Feito", "pill-ok"],
  pendente: ["Pendente", "pill-neutro"],
  aguardando: ["Aguardando você", "pill-aguarda"],
  falhou: ["Falhou", "pill-falha"],
} as const;

type Pagina = DadosDaPagina;
type Evidencia = Pagina["evidencias"][number];

const DECISAO = { aprovado: ["Aprovado", "pill-ok"], recusado: ["Recusado", "pill-falha"] } as const;

/** O botão que solta o texto recolhido logo antes dele; o montar o esconde quando o texto já cabe. */
const LER_TUDO = '<button type="button" class="link dm-ler-tudo" data-expandir>ler tudo</button>';

/** A decisão do ticket: resultado, nota e motivo (CA-11); o motivo longo fica recolhido em três linhas. */
const decisao = (d: Pagina["decisoes"][number]): string =>
  `<li class="dm-decisao dm-decisao-${d.resultado}"><div class="dm-recolhivel"><strong>${DECISAO[d.resultado][0]}</strong> por ${escapar(d.por.charAt(0).toUpperCase() + d.por.slice(1))}${d.nota === undefined ? "" : ` · nota ${String(d.nota)}`}${d.motivo === undefined ? "" : `: ${escapar(d.motivo)}`}</div>${d.motivo === undefined ? "" : LER_TUDO}</li>`;

/**
 * O resumo da evidência no chip: o resultado, nos tipos que a própria Fabriquinha gera; nos demais, o tipo legível.
 * A classe pinta o chip de verde ou vermelho.
 */
function resumoDaEvidencia({ tipo, dados }: Evidencia): { texto: string; classe: string } {
  const resultado = (ok: boolean, texto: string) => ({ texto, classe: ok ? " dm-chip-ok" : " dm-chip-falha" });
  switch (tipo) {
    case "execucao_testes": {
      const { aprovada } = dados as { aprovada: boolean };
      return resultado(aprovada, `Testes ${aprovada ? "✓" : "✗"}`);
    }
    case "matriz_fitness": {
      const { linhas } = dados as { linhas: { codigoSaida: number }[] };
      const passaram = linhas.filter((l) => l.codigoSaida === 0).length;
      return resultado(passaram === linhas.length, `Fitness ${String(passaram)}/${String(linhas.length)}`);
    }
    case "relatorio_sonar": {
      // Com o Sonar fora do ar, os dados vêm vazios: sem contagem de issues para mostrar.
      const { issues } = dados as { issues?: unknown[] };
      if (issues === undefined) return { texto: "SonarQube", classe: "" };
      return resultado(issues.length === 0, `SonarQube · ${String(issues.length)} issues`);
    }
    case "arquivos_alterados": {
      const { arquivos } = dados as { arquivos: { adicionadas: number; removidas: number }[] };
      const soma = (campo: "adicionadas" | "removidas") => arquivos.reduce((total, a) => total + a[campo], 0);
      return {
        texto: `${String(arquivos.length)} arquivos · +${String(soma("adicionadas"))} −${String(soma("removidas"))}`,
        classe: "",
      };
    }
    case "comprovacao_criterios": {
      const { criterios } = dados as { criterios: { atendido: boolean }[] };
      const atendidos = criterios.filter((c) => c.atendido).length;
      return resultado(atendidos === criterios.length, `Critérios ${String(atendidos)}/${String(criterios.length)}`);
    }
    default:
      return { texto: tipoDaEvidencia(tipo), classe: "" };
  }
}

/**
 * As evidências em chips, junto de quem as gerou (CA-10). O chip abre na caixa os anexos e os dados, guardados no
 * `<template>` ao lado; a imagem anexada e o HTML ganham chip próprio, porque são o que o Auditor quer ver.
 */
function chipsDasEvidencias(evidencias: readonly Evidencia[]): string {
  const chips = evidencias.flatMap((e) => {
    const nome = tipoDaEvidencia(e.tipo);
    const { texto, classe } = resumoDaEvidencia(e);
    const anexos = e.anexos.map(
      (a) => `<li><a class="link" href="${escapar(a.link)}" target="_blank" rel="noopener">${escapar(a.nome)}</a></li>`,
    );
    const conteudo = `${anexos.length > 0 ? `<ul class="dm-anexos">${anexos.join("")}</ul>` : ""}<pre class="dm-dados">${escapar(JSON.stringify(e.dados, null, 2))}</pre>`;
    return [
      `<button type="button" class="dm-chip${classe}" data-evidencia="${escapar(`${nome} · ${e.ticket ?? e.rodada ?? "demanda"}`)}">${texto}</button><template>${conteudo}</template>`,
      ...e.anexos
        .filter((a) => a.classe === "imagem")
        .map(
          (a) =>
            `<a class="dm-chip" href="${escapar(a.link)}" target="_blank" rel="noopener" data-imagem="${escapar(a.nome)}">${escapar(a.nome)}</a>`,
        ),
      ...e.anexos
        .filter((a) => a.classe === "html")
        .map(
          (a) =>
            `<button type="button" class="dm-chip" data-html="${escapar(a.link)}" data-nome="${escapar(nome)}">${escapar(nome)} · HTML</button>`,
        ),
    ];
  });
  return chips.length > 0 ? `<div class="dm-chips">${chips.join("")}</div>` : "";
}

/** O bloco delimitado de um gate ou formulário de ação: título em caixa alta e borda na cor do estado. */
const blocoDeAcao = (titulo: string, corpo: string, perigo = false, extra = ""): string =>
  `<div class="dm-gate${perigo ? " dm-gate-perigo" : ""}"${extra}><span class="dm-gate-titulo">${titulo}</span>${corpo}</div>`;

/** A ação do estado (CA-24 a CA-26): reabrir o ticket em falha com instrução, ou executar agora o aberto e elegível. */
function acaoDoTicket({ ref, estado, elegivel }: Pagina["tickets"][number]): string {
  const base = `/api/demandas/tickets/${escapar(ref)}`;
  if (estado === "aberto" && elegivel)
    return `<div class="dm-botoes"><button type="button" class="btn btn-grande btn-primario" data-acao="executar" data-caminho="${base}/executar">Executar agora</button></div>`;
  if (estado !== "falhou") return "";
  const campo = `instrucao-${escapar(ref)}`;
  return blocoDeAcao(
    `Reabrir ${escapar(ref)}`,
    `<label for="${campo}">Instrução (obrigatória para reabrir)</label><textarea id="${campo}" rows="3" aria-describedby="${campo}-erro"></textarea><span class="msg-erro" id="${campo}-erro" role="alert" hidden></span><div class="dm-botoes"><button type="button" class="btn btn-grande btn-primario" data-acao="reabrir" data-caminho="${base}/reabrir" data-campo="${campo}">Reabrir</button></div>`,
    true,
  );
}

/**
 * O ticket na linha do tempo. No ticket concluído e decidido, a decisão toma o lugar do "Concluído": a revisão recusada
 * não pode parecer sucesso. O marco da linha leva a mesma cor.
 */
function ticket(t: Pagina["tickets"][number], p: Pagina): string {
  const minhas = p.decisoes.filter((d) => d.ticket === t.ref);
  const ultima = minhas.at(-1);
  const decidido = t.satisfaz_dependencia && ultima !== undefined ? ultima.resultado : undefined;
  const estado = decidido
    ? pilula(DECISAO[decidido])
    : `<span class="pill ${pilulaDoEstadoDoTicket(t.estado, t.pi_ativo)}">${rotuloDoEstadoDoTicket(t.estado, t.pi_ativo)}</span>`;
  const chat = t.sessao === undefined ? "" : ` <a class="link" href="${caminhoDaSessao(t.sessao)}">chat →</a>`;
  // Só o aberto elegível ganha o destaque de "é a vez do Auditor"; o aberto que espera outro ticket fica neutro.
  const marco = decidido ?? (t.estado === "aberto" && t.elegivel ? "elegivel" : t.estado);
  return `<li class="dm-ticket dm-marco-${marco}" id="${escapar(t.ref)}"><div class="dm-no">
    <div class="dm-no-cabeca"><span class="id">${escapar(t.ref)}</span> <strong>${ETAPA_DO_TICKET[t.etapa]}</strong>${t.titulo === undefined ? "" : ` <span>${escapar(t.titulo)}</span>`}<span class="dm-no-estado">${estado}${chat}</span></div>
    ${t.instrucao === undefined ? "" : `<p class="dm-texto"><strong>Instrução:</strong> ${escapar(t.instrucao)}</p>`}
    ${t.motivo_falha === undefined ? "" : `<p class="dm-texto dm-falha"><strong>Motivo da falha:</strong> ${escapar(t.motivo_falha)}</p>`}
    ${minhas.length > 0 ? `<ul class="dm-decisoes">${minhas.map(decisao).join("")}</ul>` : ""}
    ${chipsDasEvidencias(p.evidencias.filter((e) => e.ticket === t.ref))}
    ${acaoDoTicket(t)}
  </div></li>`;
}

const listaDeTickets = (tickets: readonly Pagina["tickets"][number][], p: Pagina): string =>
  `<ol class="dm-tickets dm-tempo">${tickets.map((t) => ticket(t, p)).join("")}</ol>`;

/** O botão que abre o PR na hospedagem, para o Auditor ler o diff antes de decidir; só com endereço http(s). */
function botaoAbrirPR(pr: { id: string; url: string } | undefined): string {
  if (!pr || !/^https?:\/\//.test(pr.url)) return "";
  const hospedagem = new URL(pr.url).hostname.endsWith("github.com") ? "GitHub" : "Azure DevOps";
  return `<p class="dm-botoes"><a class="btn" href="${escapar(pr.url)}" target="_blank" rel="noopener">Abrir PR #${escapar(pr.id)} no ${hospedagem} ↗</a></p>`;
}

/**
 * Os artefatos que embasam a decisão, dentro do próprio gate, para o Auditor não caçá-los na linha do tempo. De cada
 * tipo vale a última evidência: a revisão recusada antes não é o estado que está em julgamento.
 */
function artefatosDoGate(evidencias: readonly Evidencia[]): string {
  const ultimaDeCadaTipo = [...new Map(evidencias.map((e) => [e.tipo, e])).values()];
  const chips = chipsDasEvidencias(ultimaDeCadaTipo);
  return chips === "" ? "" : blocoTitulado("Artefatos", chips);
}

/** O gate do PR da rodada (CA-20 a CA-23): aprovar com nota 1–5, ou reprovar com motivo e sem nota (D03). */
function gatePR(ref: string, pr: { id: string; url: string } | undefined, artefatos: string): string {
  const base = `/api/demandas/rodadas/${escapar(ref)}/pr`;
  const motivo = `motivo-${escapar(ref)}`;
  const nota = `nota-${escapar(ref)}`;
  const notas = [1, 2, 3, 4, 5].map((n) => `<option value="${String(n)}">${String(n)}</option>`).join("");
  const aprovar = blocoDeAcao(
    "Aprovação do PR",
    `${artefatos}${botaoAbrirPR(pr)}<label for="${nota}">Nota (obrigatória para aprovar o PR)</label><select id="${nota}" aria-describedby="${nota}-erro"><option value="">Escolha a nota</option>${notas}</select><span class="msg-erro" id="${nota}-erro" role="alert" hidden></span>
    <div class="dm-botoes"><button type="button" class="btn btn-grande btn-primario" data-gate="true" data-caminho="${base}" data-nota="${nota}">Aprovar PR</button></div>`,
    false,
    ` id="pr-${escapar(ref)}"`,
  );
  const reprovar = blocoDeAcao(
    "Reprovação do PR",
    `<label for="${motivo}">Motivo (obrigatório para reprovar o PR)</label><textarea id="${motivo}" rows="3" aria-describedby="${motivo}-erro"></textarea><span class="msg-erro" id="${motivo}-erro" role="alert" hidden></span>
    <div class="dm-botoes"><button type="button" class="btn btn-grande btn-reprovar" data-gate="false" data-caminho="${base}" data-campo="${motivo}">Reprovar PR</button></div>`,
    true,
  );
  return aprovar + reprovar;
}

/**
 * A sessão de ajustes do PR reprovado: a conversa (mensagens, perguntas do agente, trabalho) acontece no chat da sessão
 * do ticket; aqui ficam o caminho até ele e a conclusão, que é do Auditor.
 */
function sessaoDeAjustes(ref: string, sessao: string | undefined): string {
  const abrir =
    sessao === undefined
      ? '<p class="muted vazio">A conversa começa quando o pi da sessão sobe.</p>'
      : `<p class="dm-texto">Converse com o agente, responda às perguntas dele e acompanhe o trabalho no chat da sessão.</p>`;
  const botaoAbrir =
    sessao === undefined
      ? ""
      : `<a class="btn btn-grande btn-primario" href="${caminhoDaSessao(sessao)}">Abrir a sessão →</a>`;
  return `<div id="ajustes-${escapar(ref)}">${blocoDeAcao(
    `Sessão de ajustes de ${escapar(ref)}`,
    `${abrir}<div class="dm-botoes">${botaoAbrir}<button type="button" class="btn btn-grande" data-acao="concluir" data-caminho="/api/demandas/rodadas/${encodeURIComponent(ref)}/ajustes/concluir">Concluir a sessão</button></div>`,
  )}</div>`;
}

function rodadaDaPagina(r: Pagina["rodadas"][number], p: Pagina): string {
  const meus = p.tickets.filter((t) => t.rodada === r.ref);
  const encerra = meus.findLast((t) => t.etapa === "encerrar_rodada");
  const nota = p.decisoes.findLast((d) => d.ticket === encerra?.ref && d.resultado === "aprovado")?.nota;
  const pr = p.evidencias.findLast((e) => e.tipo === "pr_aberto" && e.ticket === encerra?.ref)?.dados as
    { id: string; url: string } | undefined;
  return `<section class="bloco dm-rodada" id="${escapar(r.ref)}" aria-labelledby="titulo-${escapar(r.ref)}">
    <div class="secao-titulo"><h2 id="titulo-${escapar(r.ref)}"><span class="id">${escapar(r.ref)}</span> ${escapar(r.titulo)}</h2></div>
    <div class="dm-linha">${pilula(APARENCIA_DO_ESTADO_DA_RODADA[r.estado])}${nota === undefined ? "" : ` <span class="tag">nota ${String(nota)}</span>`}${pr === undefined ? "" : ` ${linkExterno(pr.url, `PR #${escapar(pr.id)}`)}`}</div>
    ${chipsDasEvidencias(p.evidencias.filter((e) => e.rodada === r.ref && e.ticket === undefined))}
    ${meus.length > 0 ? listaDeTickets(meus, p) : '<p class="muted vazio">Sem tickets.</p>'}
    ${r.estado === "ajustar_resultado" ? sessaoDeAjustes(r.ref, meus.findLast((t) => t.etapa === "ajustar_resultado")?.sessao) : ""}
    ${r.estado === "gate_pr" ? gatePR(r.ref, pr, artefatosDoGate(p.evidencias.filter((e) => e.rodada === r.ref || meus.some((t) => t.ref === e.ticket)))) : ""}
  </section>`;
}

const secao = (id: string, titulo: string, corpo: string): string =>
  `<section class="bloco" aria-labelledby="${id}"><div class="secao-titulo"><h2 id="${id}">${titulo}</h2></div>${corpo}</section>`;

/** O encerramento final (CA-12): só com progresso; integração feita e limpeza falha nunca viram "nada integrado". */
function encerramento({
  passos,
  limpeza_pendente: pendentes,
  falha,
  aguardando_merge,
}: Pagina["encerramento"]): string {
  const feito = (nome: string) => passos.find((p) => p.passo === nome)?.feito === true;
  if (!passos.some((p) => p.feito) && !falha && pendentes.length === 0) return "";
  const limpezaFalhou = falha?.etapa === "limpeza" || pendentes.length > 0;
  const estados: [string, keyof typeof ESTADO_DO_PASSO][] = [
    ["Verificação", feito("verificacao") ? "feito" : falha?.etapa === "check_final" ? "falhou" : "pendente"],
    ["PR final", feito("pr") ? "feito" : "pendente"],
    [
      "Integração",
      feito("integracao")
        ? "feito"
        : falha?.etapa === "integracao"
          ? "falhou"
          : aguardando_merge
            ? "aguardando"
            : "pendente",
    ],
    ["Limpeza", limpezaFalhou ? "falhou" : feito("integracao") ? "feito" : "pendente"],
  ];
  const itens = estados.map(([nome, estado]) => {
    const motivo =
      estado === "falhou" && falha && (nome === "Limpeza") === (falha.etapa === "limpeza") ? falha : undefined;
    const detalhe = [
      ...(motivo ? [escapar(motivo.motivo)] : []),
      ...(estado === "aguardando" && aguardando_merge
        ? [linkExterno(aguardando_merge.url, "aprove e integre o PR final na plataforma")]
        : []),
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

/** Os gates que o estado pede: a rota da decisão e os rótulos dos dois botões. */
const GATES: Partial<Record<EstadoDemanda, { titulo: string; rota: string; aprovar: string; recusar: string }>> = {
  gate_demanda: { titulo: "Aprovação da demanda", rota: "decisao", aprovar: "Aprovar", recusar: "Recusar" },
  gate_planejamento: {
    titulo: "Aprovação do planejamento",
    rota: "planejamento/decisao",
    aprovar: "Aprovar planejamento",
    recusar: "Reprovar planejamento",
  },
};

// ——— o que o Auditor lê na aprovação da demanda ———

interface CriterioDeAceite {
  id: string;
  dado: string;
  quando: string;
  entao: string;
}
interface DesenhoDaSolucao {
  resumo: string;
  arquivosPrevistos: { caminho: string; acao: string; motivo: string }[];
  foraDeEscopo: string[];
}
type Impacto = "baixo" | "medio" | "alto";
const IMPACTO: Record<Impacto, string> = { baixo: "baixo", medio: "médio", alto: "alto" };

/** A evidência `tipo` da própria demanda (sem rodada nem ticket), a última submetida. */
const evidenciaDaDemanda = (p: Pagina, tipo: string): Pagina["evidencias"][number] | undefined =>
  p.evidencias.findLast((e) => e.tipo === tipo && e.rodada === undefined && e.ticket === undefined);

const tabela = (cabecalho: string, linhas: string[]): string =>
  `<div class="rola"><table class="tabela"><thead><tr>${cabecalho}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;

/** Uma célula com o texto curto do agente, em Markdown de linha. */
const celulaDoAgente = (texto: string): string => `<td class="md">${markdownEmLinha(texto)}</td>`;

/** Um card de número, com o rótulo no singular ou no plural. */
const numero = (valor: string, rotulo: string): string =>
  `<div class="numero"><strong>${valor}</strong><span>${rotulo}</span></div>`;
const contagem = (n: number, um: string, varios: string): string => numero(String(n), n === 1 ? um : varios);

const blocoTitulado = (titulo: string, corpo: string): string =>
  `<div><div class="titulo-bloco">${titulo}</div>${corpo}</div>`;

/** O card que abre o HTML da evidência na caixa; sem HTML anexado, nada. */
function cardDoHtml(e: Pagina["evidencias"][number], nome: string): string {
  const html = e.anexos.find((a) => a.classe === "html");
  return html
    ? `<button type="button" class="art" data-html="${escapar(html.link)}" data-nome="${escapar(nome)}"><span class="tipo">HTML</span>${nome}</button>`
    : "";
}

/**
 * O que o Auditor precisa para decidir a demanda: tipo, descrição e comportamento, os critérios de aceite em tabela e o
 * desenho da solução (números, resumo, arquivos previstos, fora de escopo e o HTML, que abre na caixa). Os números do
 * impacto só aparecem com o relatório de impactos na arquitetura.
 */
function oQueAAprovacaoMostra(p: Pagina): string {
  const comportamento = evidenciaDaDemanda(p, "comportamento")?.dados as { descricao: string } | undefined;
  const fatos =
    `<dl class="fatos"><dt>Tipo</dt><dd><span class="tag">${escapar(p.demanda.tipo)}</span></dd>` +
    `<dt>Descrição</dt><dd><div class="md">${markdown(p.demanda.descricao)}</div></dd>` +
    (comportamento ? `<dt>Comportamento</dt><dd><div class="md">${markdown(comportamento.descricao)}</div></dd>` : "") +
    "</dl>";
  const criterios = (evidenciaDaDemanda(p, "criterios_aceite")?.dados as { criterios: CriterioDeAceite[] } | undefined)
    ?.criterios;
  const tabelaDeCriterios = criterios
    ? tabela(
        "<th>ID</th><th>Dado</th><th>Quando</th><th>Então</th>",
        criterios.map(
          (c) =>
            `<tr><td class="mono">${escapar(c.id)}</td>${[c.dado, c.quando, c.entao].map(celulaDoAgente).join("")}</tr>`,
        ),
      )
    : '<p class="muted">Sem critérios de aceite.</p>';
  return `<div class="dm-aprovacao">${fatos}${blocoTitulado("Critérios de aceite", tabelaDeCriterios)}${blocoTitulado("Desenho da solução", desenhoDaSolucao(p))}</div>`;
}

function desenhoDaSolucao(p: Pagina): string {
  const evidencia = evidenciaDaDemanda(p, "desenho_solucao");
  if (!evidencia) return '<p class="muted">Sem desenho da solução.</p>';
  const desenho = evidencia.dados as DesenhoDaSolucao;
  const relatorio = evidenciaDaDemanda(p, "relatorio_impactos_arquitetura");
  const impactos = relatorio?.dados as { impacto: Impacto; novosAcoplamentos: unknown[] } | undefined;
  const numeros = [
    contagem(desenho.arquivosPrevistos.length, "arquivo previsto", "arquivos previstos"),
    ...(impactos
      ? [
          contagem(impactos.novosAcoplamentos.length, "acoplamento novo", "acoplamentos novos"),
          numero(
            `<span class="impacto-${impactos.impacto}">${IMPACTO[impactos.impacto]}</span>`,
            "impacto na arquitetura",
          ),
        ]
      : []),
  ];
  const arquivos = tabela(
    "<th>Arquivo</th><th>Ação</th><th>Motivo</th>",
    desenho.arquivosPrevistos.map(
      (a) =>
        `<tr><td class="mono">${escapar(a.caminho).replaceAll("/", "/<wbr>")}</td><td>${escapar(a.acao)}</td>${celulaDoAgente(a.motivo)}</tr>`,
    ),
  );
  const fora =
    desenho.foraDeEscopo.length > 0
      ? blocoTitulado(
          "Fora de escopo",
          `<div class="md"><ul>${desenho.foraDeEscopo.map((f) => `<li>${markdownEmLinha(f)}</li>`).join("")}</ul></div>`,
        )
      : "";
  const cards = [
    cardDoHtml(evidencia, "Desenho da solução"),
    ...(relatorio ? [cardDoHtml(relatorio, "Impactos na arquitetura")] : []),
  ].join("");
  return `<div class="dm-desenho"><div class="numeros">${numeros.join("")}</div><div class="md">${markdown(desenho.resumo)}</div>${blocoTitulado("Arquivos previstos", arquivos)}${fora}${cards === "" ? "" : `<div class="cards-art">${cards}</div>`}</div>`;
}

/**
 * O formulário do gate do estado atual (CA-14 a CA-19); fora de um gate, nada. O motivo só vale para recusar. Na
 * aprovação da demanda, o que o Auditor lê para decidir vem antes do motivo.
 */
function gate(p: Pagina): string {
  const { id, estado } = p.demanda;
  const g = GATES[estado];
  if (!g) return "";
  const campo = `motivo-${g.rota.replaceAll("/", "-")}`;
  const planejadores = p.tickets.filter((t) => t.etapa === "planejar").map((t) => t.ref);
  const leitura =
    estado === "gate_demanda"
      ? oQueAAprovacaoMostra(p)
      : artefatosDoGate(p.evidencias.filter((e) => e.ticket !== undefined && planejadores.includes(e.ticket)));
  const botao = (aprovado: boolean, rotulo: string) =>
    `<button type="button" class="btn btn-grande ${aprovado ? "btn-primario" : "btn-reprovar"}" data-gate="${String(aprovado)}" data-caminho="/api/demandas/${escapar(id)}/${g.rota}" data-campo="${campo}">${rotulo}</button>`;
  return blocoDeAcao(
    g.titulo,
    `${leitura}<label for="${campo}">Motivo (obrigatório para ${g.recusar.toLowerCase()})</label><textarea id="${campo}" rows="3" aria-describedby="${campo}-erro"></textarea><span class="msg-erro" id="${campo}-erro" role="alert" hidden></span><div class="dm-botoes">${botao(false, g.recusar)}${botao(true, g.aprovar)}</div>`,
    false,
    ' id="gate"',
  );
}

/** Um cartão da lateral: o contexto que acompanha o Auditor enquanto ele desce pela linha do tempo. */
const cartaoLateral = (id: string, titulo: string, corpo: string): string =>
  `<section class="superficie dm-cartao-lateral" aria-labelledby="${id}"><h2 class="titulo-bloco" id="${id}">${titulo}</h2>${corpo}</section>`;

/**
 * Cancelar (CA-27) ou arquivar (CA-29). Cancelar só abre a confirmação, que lista as dependentes que vão junto; nada é
 * enviado antes de confirmar.
 */
function acoesDaDemanda({ demanda: { id, terminal, arquivavel }, dependentes }: Pagina): string {
  const caminho = `/api/demandas/${escapar(id)}`;
  const botao = (acao: string, classe: string, rotulo: string, extra = "") =>
    `<button type="button" class="btn btn-grande ${classe}" data-demanda="${acao}"${extra}>${rotulo}</button>`;
  if (arquivavel)
    return cartaoLateral(
      "titulo-acoes",
      "Ações",
      `<div class="dm-botoes">${botao("arquivar", "btn-primario", "Arquivar", ` data-caminho="${caminho}/arquivar"`)}</div>`,
    );
  if (terminal) return "";
  const junto =
    dependentes.length > 0
      ? `<p class="dm-texto">Estas demandas dependem desta e serão canceladas junto:</p><ul class="dm-tickets">${dependentes.map((d) => `<li class="dm-linha"><a class="link id" href="${caminhoDaDemanda(d.demanda_id)}">${escapar(d.demanda_id)}</a> ${escapar(d.titulo)} ${pilula(APARENCIA_DO_ESTADO_DA_DEMANDA[d.estado])}</li>`).join("")}</ul>`
      : '<p class="dm-texto">Nenhuma outra demanda depende desta.</p>';
  return cartaoLateral(
    "titulo-acoes",
    "Ações",
    `<div class="dm-botoes">${botao("abrir-cancelar", "btn-reprovar", "Cancelar a demanda")}</div>
    ${blocoDeAcao(`Cancelar ${escapar(id)}`, `${junto}<div class="dm-botoes">${botao("voltar", "", "Voltar")}${botao("cancelar", "btn-reprovar", "Confirmar o cancelamento", ` data-caminho="${caminho}/cancelar"`)}</div>`, true, " data-confirmar-cancelar hidden")}`,
  );
}

/** O que espera o Auditor, com o link até onde ele age: o gate do estado, o PR ou a sessão da rodada, o ticket. */
function aguardaVoce({ demanda, rodadas, tickets, encerramento: { aguardando_merge } }: Pagina): string {
  const gateDoEstado = GATES[demanda.estado];
  const itens = [
    ...(gateDoEstado ? [["gate", gateDoEstado.titulo]] : []),
    ...(aguardando_merge ? [["titulo-encerramento", "Integrar o PR final"]] : []),
    ...rodadas
      .filter((r) => r.estado === "gate_pr" || r.estado === "ajustar_resultado")
      .map((r) => [
        `${r.estado === "ajustar_resultado" ? "ajustes" : "pr"}-${r.ref}`,
        `${APARENCIA_DO_ESTADO_DA_RODADA[r.estado][0]} · ${r.ref}`,
      ]),
    ...tickets
      .filter((t) => t.estado === "falhou" || (t.estado === "aberto" && t.elegivel))
      .map((t) => [
        t.ref,
        `${t.estado === "falhou" ? "Reabrir" : "Executar"} ${t.ref}${t.titulo === undefined ? "" : ` · ${t.titulo}`}`,
      ]),
  ];
  if (itens.length === 0) return "";
  const links = itens.map(
    ([alvo = "", texto = ""]) => `<li><a class="link" href="#${escapar(alvo)}">${escapar(texto)} ↓</a></li>`,
  );
  return `<section class="superficie dm-cartao-lateral dm-aguarda" aria-labelledby="titulo-aguarda"><h2 class="titulo-bloco" id="titulo-aguarda">Aguarda você</h2><ul class="dm-tickets">${links.join("")}</ul></section>`;
}

interface Comprovacao {
  criterios: { id: string; atendido: boolean }[];
}

/**
 * Os critérios de aceite com o resultado da última comprovação; o que falhou diz em quantas comprovações, para a rodada
 * que anda em círculo saltar aos olhos.
 */
function criteriosDaLateral(p: Pagina): string {
  const criterios = (evidenciaDaDemanda(p, "criterios_aceite")?.dados as { criterios: CriterioDeAceite[] } | undefined)
    ?.criterios;
  if (!criterios) return "";
  const comprovacoes = p.evidencias
    .filter((e) => e.tipo === "comprovacao_criterios")
    .map((e) => (e.dados as Comprovacao).criterios);
  const itens = criterios.map((c) => {
    const resultados = comprovacoes.flatMap((lista) => lista.filter((x) => x.id === c.id).map((x) => x.atendido));
    const ultimo = resultados.at(-1);
    const falhas = resultados.filter((atendido) => !atendido).length;
    const [classe, estado] =
      ultimo === undefined
        ? ["neutro", "sem comprovação"]
        : ultimo
          ? ["ok", "comprovado"]
          : ["falha", `não comprovado em ${String(falhas)} ${falhas === 1 ? "comprovação" : "comprovações"}`];
    return `<li><div class="dm-linha"><span class="dm-bolinha dm-bolinha-${classe}" aria-hidden="true"></span><span class="mono">${escapar(c.id)}</span><span class="muted">${estado}</span></div><div class="dm-ca-entao md">${markdownEmLinha(c.entao)}</div></li>`;
  });
  return cartaoLateral("titulo-criterios", "Critérios de aceite", `<ul class="dm-criterios">${itens.join("")}</ul>`);
}

/** Os estados da demanda no trilho do cabeçalho; os losangos são os gates do Auditor. */
const TRILHO: readonly { estado: EstadoDemanda; gate?: true }[] = [
  { estado: "entender_e_desenhar" },
  { estado: "gate_demanda", gate: true },
  { estado: "planejar" },
  { estado: "gate_planejamento", gate: true },
  { estado: "em_execucao" },
  { estado: "revisar_demanda" },
  { estado: "encerrar_demanda" },
  { estado: "concluida" },
];

/** Onde o estado fica no trilho: concluída e arquivada o completam, e a cancelada fica sem ele. */
function posicaoNoTrilho(estado: EstadoDemanda): number | undefined {
  switch (estado) {
    case "cancelada":
      return undefined;
    case "concluida":
    case "arquivada":
      return TRILHO.length;
    default:
      return TRILHO.findIndex((passo) => passo.estado === estado);
  }
}

/** Onde a demanda está no caminho; concluída e arquivada completam o trilho, e a cancelada fica sem ele. */
function trilhoDeEstados(estado: EstadoDemanda): string {
  const atual = posicaoNoTrilho(estado);
  if (atual === undefined) return "";
  const passos = TRILHO.map(({ estado: passo, gate }, i) => {
    const classes = [
      "dm-passo-trilho",
      ...(gate ? ["gate"] : []),
      ...(i < atual ? ["feito"] : i === atual ? ["atual"] : []),
    ];
    return `<li class="${classes.join(" ")}"${i === atual ? ' aria-current="step"' : ""}><span class="dm-marco-trilho"></span><span>${APARENCIA_DO_ESTADO_DA_DEMANDA[passo][0]}</span></li>`;
  });
  return `<ol class="dm-trilho" aria-label="Fases da demanda">${passos.join("")}</ol>`;
}

/**
 * A linha do tempo, na ordem dos tickets: os globais de antes da primeira rodada (demanda e planejamento), as rodadas e
 * os globais que vieram depois delas.
 */
function linhaDoTempo(p: Pagina): string {
  const primeira = p.tickets.findIndex((t) => t.rodada !== undefined);
  const corte = primeira === -1 ? p.tickets.length : primeira;
  const globais = (id: string, titulo: string, tickets: Pagina["tickets"]) => {
    const deles = tickets.filter((t) => t.rodada === undefined);
    return deles.length > 0 ? secao(id, titulo, listaDeTickets(deles, p)) : "";
  };
  return [
    globais("titulo-antes", "Antes das rodadas", p.tickets.slice(0, corte)),
    ...p.rodadas.map((r) => rodadaDaPagina(r, p)),
    globais("titulo-depois", "Depois das rodadas", p.tickets.slice(corte)),
  ].join("");
}

/**
 * A página em mesa: a lateral fixa com o que aguarda o Auditor e o contexto da demanda; ao centro, o gate do estado, a
 * linha do tempo e o encerramento. Na aprovação da demanda, o próprio gate já mostra a descrição e os critérios.
 */
export function pagina(p: DadosDaPagina): string {
  const { demanda: d } = p;
  const naAprovacao = d.estado === "gate_demanda";
  const evidenciasDaDemanda = chipsDasEvidencias(
    p.evidencias.filter((e) => e.rodada === undefined && e.ticket === undefined),
  );
  const lateral = [
    aguardaVoce(p),
    naAprovacao ? "" : criteriosDaLateral(p),
    naAprovacao
      ? ""
      : cartaoLateral(
          "titulo-descricao",
          "Descrição",
          `<div class="md dm-descricao">${markdown(d.descricao)}</div>${LER_TUDO}`,
        ),
    p.dependencias.length > 0
      ? cartaoLateral(
          "titulo-dependencias",
          "Dependências",
          `<ul class="dm-tickets">${p.dependencias.map((x) => `<li class="dm-linha"><a class="link id" href="${caminhoDaDemanda(x.demanda_id)}">${escapar(x.demanda_id)}</a> ${pilula(APARENCIA_DO_ESTADO_DA_DEMANDA[x.estado])}</li>`).join("")}</ul>`,
        )
      : "",
    evidenciasDaDemanda === "" ? "" : cartaoLateral("titulo-evidencias", "Evidências da demanda", evidenciasDaDemanda),
    acoesDaDemanda(p),
  ];
  return `<a class="link" href="/home">← Início</a>
  <div class="cabeca-pagina dm-cabeca"><h1>${escapar(d.titulo)}</h1>
    <div class="dm-linha"><span class="id">${escapar(d.id)}</span><span class="tag">${escapar(d.projeto)}</span><span class="tag">${escapar(d.tipo)}</span>${pilula(APARENCIA_DO_ESTADO_DA_DEMANDA[d.estado])}</div></div>
  ${trilhoDeEstados(d.estado)}
  <div class="dm-mesa">
    <aside class="dm-lateral" aria-label="Contexto da demanda">${lateral.join("")}</aside>
    <div class="dm-principal">${gate(p)}${linhaDoTempo(p)}${encerramento(p.encerramento)}</div>
  </div>`;
}
