// Página do projeto (F7 §4.4) como funções puras: o seletor, as abas, os cards do mês, a barra com a contagem e os
// filtros, e uma linha por demanda com a linha do tempo dos estados, as rodadas da execução e a gaveta de tickets. O DOM
// e a rede ficam em projeto-montar.ts.
import type { EtapaTicket, EstadoDemanda, EstadoRodada, EstadoTicket } from "../../../nucleo/primitivos.ts";
import type { MetricasMesDemanda } from "../../../aplicacao/periodo_demanda.ts";
import type { DemandaDoProjeto, ListaDoProjeto } from "../../http/rotas/projeto.ts";
import {
  caminhoDaDemanda,
  caminhoDaSessao,
  diaMes,
  escapar,
  pilulaDoEstadoDoTicket,
  rotuloDoEstadoDoTicket,
  plural,
  rotuloDoModelo,
  nomeDoEstadoDoTicket,
} from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { ETAPA_DO_TICKET } from "./demandas.ts";
import { cardsDoMes } from "./metricas.ts";

export const caminhoDoProjeto = (nome: string): string => `/projects/${encodeURIComponent(nome)}`;

/** O que o Auditor escolheu na página: os filtros e as gavetas que ele abriu ou fechou. */
export interface Escolhas {
  mostrar: { concluidas: boolean; arquivadas: boolean; canceladas: boolean };
  /** A gaveta que o Auditor abriu ou fechou; as demais seguem o padrão (aberta quando aguarda ou falhou). */
  gavetas: ReadonlyMap<string, boolean>;
}

/** O projeto de `/projects`: o último visto neste navegador, se ainda existe, ou o primeiro em ordem alfabética. */
export const escolherProjeto = (projetos: readonly ProjetoListado[], ultimo?: string): string | undefined =>
  projetos.find((p) => p.nome === ultimo)?.nome ?? projetos[0]?.nome;

export const SEM_PROJETOS =
  '<div class="cabeca-pagina"><h1>Projetos</h1></div><p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo">Cadastrar um projeto na Configuração</a></p>';

export const projetoNaoEncontrado = (nome: string): string =>
  `<div class="cabeca-pagina"><h1>Projeto não encontrado</h1></div><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/projects">Ver os projetos</a></p>`;

/** A confirmação do **Arquivar concluídas**: quantas e que nada é apagado. */
/** @testes função pura da tela, testada sem montar o DOM */
export const confirmacaoDeArquivar = (n: number, projeto: string): string =>
  `<dialog class="dialogo" data-dialogo aria-labelledby="titulo-arquivar"><h2 id="titulo-arquivar">Arquivar concluídas</h2><p>${
    n === 1
      ? `1 demanda concluída de ${escapar(projeto)} será arquivada. Ela sai desta lista e continua acessível`
      : `${String(n)} demandas concluídas de ${escapar(projeto)} serão arquivadas. Elas saem desta lista e continuam acessíveis`
  } em "Mostrar arquivadas". Nada é apagado.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar>Arquivar</button></form></dialog>`;

/** Os estados da demanda em andamento, na ordem do processo; `em_execucao` é o trecho das rodadas. */
const ORDEM_DA_DEMANDA: readonly EstadoDemanda[] = [
  "entender_e_desenhar",
  "gate_demanda",
  "planejar",
  "gate_planejamento",
  "em_execucao",
  "revisar_demanda",
  "encerrar_demanda",
];
/** Os estados da rodada em andamento, na ordem do processo; a sessão de ajustes só acontece com o PR reprovado. */
const ORDEM_DA_RODADA: readonly EstadoRodada[] = [
  "implementar",
  "revisar_rodada",
  "encerrar_rodada",
  "gate_pr",
  "ajustar_resultado",
];

interface Coluna {
  estado: EstadoDemanda | EstadoRodada;
  de: "demanda" | "rodada";
  rotulo: string;
  gate?: true;
}

/** As 11 colunas da linha do tempo: as da demanda e, no trecho da execução, as da rodada. */
const COLUNAS: readonly Coluna[] = [
  { estado: "entender_e_desenhar", de: "demanda", rotulo: "Registro" },
  { estado: "gate_demanda", de: "demanda", rotulo: "Aprovação da demanda", gate: true },
  { estado: "planejar", de: "demanda", rotulo: "Planejamento" },
  { estado: "gate_planejamento", de: "demanda", rotulo: "Aprovação do planejamento", gate: true },
  { estado: "implementar", de: "rodada", rotulo: "Desenvol&shy;vimento" },
  { estado: "revisar_rodada", de: "rodada", rotulo: "Revisão" },
  { estado: "encerrar_rodada", de: "rodada", rotulo: "Encerramento" },
  { estado: "gate_pr", de: "rodada", rotulo: "Aprovação do PR", gate: true },
  { estado: "ajustar_resultado", de: "rodada", rotulo: "Ajustes do PR" },
  { estado: "revisar_demanda", de: "demanda", rotulo: "Revisão da demanda" },
  { estado: "encerrar_demanda", de: "demanda", rotulo: "Encerramento da demanda" },
];

/** As 5 etapas do processo sobre as colunas, com quantas colunas cada uma agrupa: Implementar é o trecho das rodadas. */
const ETAPAS_DO_PROCESSO: readonly (readonly [string, number])[] = [
  ["Registrar", 2],
  ["Planejar", 2],
  ["Implementar", 5],
  ["Revisar", 1],
  ["Encerrar", 1],
];

/** A cor do marco atual e da borda da linha: a falha antes de quem aguarda, e quem aguarda antes do que roda. */
type EstadoDaLinha = "falha" | "aguarda" | "rodando" | "cancelada";

const GATES_DA_RODADA: ReadonlySet<EstadoRodada> = new Set(["gate_pr", "ajustar_resultado"]);

/** A demanda que terminou sem satisfazer a dependência de quem a espera: a cancelada. */
const foiCancelada = (d: Pick<DemandaDoProjeto, "terminal" | "satisfazDependencia">): boolean =>
  d.terminal && !d.satisfazDependencia;

/** O estado da demanda: ticket falho, gate da demanda, do planejamento ou do PR, ou ticket em execução. */
/** @testes função pura da tela, testada sem montar o DOM */
export function estadoDaDemanda(d: DemandaDoProjeto): EstadoDaLinha | undefined {
  if (d.terminal) return foiCancelada(d) ? "cancelada" : undefined;
  if (d.tickets.some((t) => t.estado === "falhou")) return "falha";
  const noGate =
    d.estado === "gate_demanda" ||
    d.estado === "gate_planejamento" ||
    (d.estado === "em_execucao" && d.rodadas.some((r) => GATES_DA_RODADA.has(r.estado)));
  if (noGate) return "aguarda";
  return d.tickets.some((t) => t.estado === "em_execucao") ? "rodando" : undefined;
}

/** O estado da rodada, pelos tickets dela; na demanda cancelada, apagado. */
function estadoDaRodada(d: DemandaDoProjeto, rodada: DemandaDoProjeto["rodadas"][number]): EstadoDaLinha | undefined {
  if (foiCancelada(d)) return "cancelada";
  const tickets = d.tickets.filter((t) => t.rodada === rodada.ref);
  if (tickets.some((t) => t.estado === "falhou")) return "falha";
  if (GATES_DA_RODADA.has(rodada.estado)) return "aguarda";
  return tickets.some((t) => t.estado === "em_execucao") ? "rodando" : undefined;
}

/**
 * Como cada coluna aparece: `feito` a passada, `atual` a atual, `""` a que ainda não chegou, `pulada` os Ajustes do PR
 * que não houve (a linha passa contínua por ela), `rodadas` o trecho da execução na linha da demanda (as rodadas,
 * abaixo, levam os marcos) e `fora` a coluna da demanda na linha da rodada.
 */
type Situacao = "feito" | "atual" | "" | "pulada" | "rodadas" | "fora";

/** A situação de cada coluna pela posição da coluna e do estado atual numa ordem; `concluida` passa de todas. */
function situacaoNaOrdem<F extends string>(ordem: readonly F[], estado: F | "concluida", coluna: Coluna): Situacao {
  const posicao = ordem.indexOf(estado as F);
  const atual = posicao === -1 ? ordem.length : posicao;
  const indice = ordem.indexOf(coluna.estado as F);
  if (indice === atual) return "atual";
  return indice < atual ? "feito" : "";
}

/** Cada coluna com a situação dela na linha. */
type ColunasDaLinha = (readonly [Coluna, Situacao])[];

/** As colunas na linha da demanda; `comAjustes` diz se alguma rodada passou pela sessão de ajustes do PR. */
/** @testes função pura da tela, testada sem montar o DOM */
export function situacaoNaDemanda(estado: EstadoDemanda, comAjustes: boolean): ColunasDaLinha {
  const trecho = situacaoNaOrdem(ORDEM_DA_DEMANDA, estado, { estado: "em_execucao", de: "demanda", rotulo: "" });
  const situacao = (coluna: Coluna): Situacao => {
    if (coluna.de === "demanda") return situacaoNaOrdem(ORDEM_DA_DEMANDA, estado, coluna);
    if (trecho === "atual") return "rodadas";
    if (trecho !== "feito") return "";
    return coluna.estado !== "ajustar_resultado" || comAjustes ? "feito" : "pulada";
  };
  return COLUNAS.map((coluna) => [coluna, situacao(coluna)]);
}

/** As colunas na linha da rodada; `comAjustes` diz se ela passou pela sessão de ajustes do PR. */
/** @testes função pura da tela, testada sem montar o DOM */
export function situacaoNaRodada(estado: EstadoRodada, comAjustes: boolean): ColunasDaLinha {
  const situacao = (coluna: Coluna): Situacao => {
    if (coluna.de === "demanda") return "fora";
    const naOrdem = situacaoNaOrdem(ORDEM_DA_RODADA, estado, coluna);
    return naOrdem === "feito" && coluna.estado === "ajustar_resultado" && !comAjustes ? "pulada" : naOrdem;
  };
  return COLUNAS.map((coluna) => [coluna, situacao(coluna)]);
}

/** A linha do tempo: passadas em verde, a atual maior e com a cor do estado, as de gate em losango. */
function linhaDoTempo(colunas: ColunasDaLinha, estado: EstadoDaLinha | undefined, rotulo: string): string {
  const passos = colunas.map(([{ rotulo: estado, gate }, situacao]) => {
    const classes = ["passo", gate && "gate", situacao];
    const corrente = situacao === "atual" ? ' aria-current="step"' : "";
    return `<li class="${classes.filter(Boolean).join(" ")}"${corrente}><span class="linha"><span class="marco"></span></span><span>${estado}</span></li>`;
  });
  return `<ol class="${["trilho-estados", estado].filter(Boolean).join(" ")}" aria-label="${rotulo}">${passos.join("")}</ol>`;
}

/** Há quanto tempo, em minutos ou horas e minutos, com espaços não separáveis: "1 min" nunca se separa. */
/** @testes função pura da tela, testada sem montar o DOM */
export function ha(desde: string, agora: Date): string {
  const minutos = Math.floor((agora.getTime() - Date.parse(desde)) / 60_000);
  let duracao = `${String(Math.floor(minutos / 60))} h ${String(minutos % 60)} min`;
  if (minutos < 1) duracao = "menos de 1 min";
  else if (minutos < 60) duracao = `${String(minutos)} min`;
  return `há ${duracao.replaceAll(" ", " ")}`;
}

/** O estado do ticket que dá a cor da linha, à direita, quando ela falhou ou roda. */
const ESTADO_DO_DESTAQUE: Partial<Record<EstadoDaLinha, EstadoTicket>> = { falha: "falhou", rodando: "em_execucao" };

/** À direita da linha: o gate com o link para a demanda, ou o ticket falho ou em execução com o chat. */
function destaque(d: DemandaDoProjeto, estado: EstadoDaLinha | undefined, agora: Date): string {
  if (estado === "aguarda") {
    return `<a class="chat" href="${caminhoDaDemanda(d.id)}"><span class="pill pill-aguarda">Aguarda você</span><span class="ir">abrir →</span></a>`;
  }
  const ticket = estado && d.tickets.find((t) => t.estado === ESTADO_DO_DESTAQUE[estado]);
  if (!ticket) return "";
  const conteudo = `<span class="pill ${pilulaDoEstadoDoTicket(ticket.estado, ticket.piAtivo)}">${rotuloDoEstadoDoTicket(ticket.estado, ticket.piAtivo)}</span><span class="muted quando">${ha(ticket.estadoAlteradoEm, agora)}</span>`;
  return ticket.sessao === undefined
    ? `<span class="chat">${conteudo}</span>`
    : `<a class="chat" href="${caminhoDaSessao(ticket.sessao)}">${conteudo}<span class="ir">chat →</span></a>`;
}

/** Como cada estado de quem saiu do andamento diz quando: o rótulo e a classe do texto. */
const SAIDA_DO_ANDAMENTO: Partial<Record<EstadoDemanda, { rotulo: string; classe: string }>> = {
  cancelada: { rotulo: "cancelada", classe: ' class="cancelada"' },
  arquivada: { rotulo: "arquivada", classe: "" },
  concluida: { rotulo: "concluída", classe: "" },
};

/** Quando a demanda saiu do andamento: cancelada, arquivada ou concluída. */
function quando(d: DemandaDoProjeto): string {
  const saida = SAIDA_DO_ANDAMENTO[d.estado];
  return saida ? `<span${saida.classe}>${saida.rotulo} em ${diaMes(new Date(d.estadoAlteradoEm))}</span>` : "";
}

/** O que fica sob o título: `I-n`, tipo, a dependência que bloqueia, o progresso e quando saiu do andamento. */
function marcas(d: DemandaDoProjeto): string {
  const feitos = d.tickets.filter((t) => t.satisfazDependencia).length;
  const largura = String((100 * feitos) / Math.max(1, d.tickets.length));
  const partes = [`<span class="id">${escapar(d.id)}</span>`, `<span class="tag">${d.tipo}</span>`];
  if (d.bloqueadaPor.length > 0) {
    partes.push(`<span class="bloqueia">bloqueada por ${d.bloqueadaPor.map(escapar).join(", ")}</span>`);
  }
  partes.push(
    `<span class="progresso" title="tickets concluídos">${String(feitos)}/${String(d.tickets.length)}<span class="trilho-p"><i style="width:${largura}%"></i></span></span>`,
    quando(d),
  );
  return partes.join("");
}

const linkDoPr = (pr: { id: string; url: string }): string =>
  /^https?:\/\//.test(pr.url)
    ? `<a class="pr" href="${escapar(pr.url)}" target="_blank" rel="noopener">PR #${escapar(pr.id)}</a>`
    : `<span class="pr">PR #${escapar(pr.id)}</span>`;

/** Se a rodada (ou, sem ela, alguma rodada da demanda) passou pela sessão de ajustes do PR. */
const passouPelosAjustes = (d: DemandaDoProjeto, rodada?: string): boolean =>
  d.tickets.some((t) => t.etapa === "ajustar_resultado" && (rodada === undefined || t.rodada === rodada));

/** Uma sub-linha por rodada, na execução: o endereço, o título e o PR, e a linha do tempo só no trecho das rodadas. */
function rodadas(d: DemandaDoProjeto): string {
  return d.rodadas
    .map(
      (r) => `<div class="pista-rodada">
      <div class="pista-demanda"><span class="sub"><span class="id">${escapar(r.ref)}</span><span class="rodada-titulo" title="${escapar(r.titulo)}">${escapar(r.titulo)}</span>${r.pr ? linkDoPr(r.pr) : ""}</span></div>
      ${linhaDoTempo(situacaoNaRodada(r.estado, passouPelosAjustes(d, r.ref)), estadoDaRodada(d, r), `Fases da rodada ${escapar(r.ref)}`)}
      <div></div>
    </div>`,
    )
    .join("");
}

/** O título do ticket que não tem um: o que a etapa faz, como o antigo mostrava. */
const TITULO_DA_ETAPA: Record<EtapaTicket, string> = {
  entender_e_desenhar: "Registrar a demanda",
  planejar: "Planejar a demanda",
  implementar: "Implementar",
  revisar_rodada: "Revisar a rodada",
  encerrar_rodada: "Encerrar a rodada",
  ajustar_resultado: "Sessão de ajustes",
  resolver_conflito: "Resolver o conflito",
  revisar_demanda: "Revisar a demanda",
  encerrar_demanda: "Encerrar a demanda",
};

/** A gaveta: os tickets da demanda, com a etapa, o endereço, o título, o estado, o modelo e o chat. */
function gaveta(d: DemandaDoProjeto): string {
  const linhas = d.tickets.map((t) => {
    const encerrado = t.terminal;
    // A sessão de ajustes conversa na página da demanda, não no chat.
    const chat =
      t.sessao === undefined || t.etapa === "ajustar_resultado"
        ? ""
        : `<a class="chat" href="${caminhoDaSessao(t.sessao)}"><span class="ir">chat →</span></a>`;
    return `<tr${encerrado ? ' class="apagada"' : ""}>
      <td class="etapa-cel">${ETAPA_DO_TICKET[t.etapa].toLowerCase()}</td>
      <td class="id-cel"><span class="id">${escapar(t.ref)}</span></td>
      <td class="titulo-cel">${escapar(t.titulo ?? TITULO_DA_ETAPA[t.etapa])}</td>
      <td class="status-cel"><span class="pill ${pilulaDoEstadoDoTicket(t.estado, t.piAtivo)}">${nomeDoEstadoDoTicket(t.estado, t.piAtivo)}</span></td>
      <td class="modelo-cel">${rotuloDoModelo(t.modelo ?? "padrão do pi")}</td>
      <td class="sessao-cel">${chat}</td>
    </tr>`;
  });
  return `<div class="gaveta">${linhas.length > 0 ? `<table>${linhas.join("")}</table>` : '<p class="muted">Nenhum ticket ainda.</p>'}</div>`;
}

/** Uma linha por demanda: título e marcas, a linha do tempo, o destaque, as rodadas na execução e a gaveta. */
function linha(d: DemandaDoProjeto, { gavetas }: Escolhas, agora: Date): string {
  const corDaLinha = estadoDaDemanda(d);
  const aberta = gavetas.get(d.id) ?? (corDaLinha === "aguarda" || corDaLinha === "falha");
  const estado = d.estadoNaLinhaDoTempo;
  const classes = ["pista-item", corDaLinha, !aberta && "fechada", d.terminal && "apagada"];
  return `<div class="${classes.filter(Boolean).join(" ")}" data-demanda="${escapar(d.id)}">
    <div class="pista-linha" data-gaveta>
      <div class="pista-demanda"><button type="button" class="caret" aria-expanded="${String(aberta)}" aria-label="Tickets de ${escapar(d.id)}">▼</button><div class="texto">
        <a class="titulo" href="${caminhoDaDemanda(d.id)}">${escapar(d.titulo)}</a>
        <span class="sub">${marcas(d)}</span>
      </div></div>
      ${linhaDoTempo(situacaoNaDemanda(estado, passouPelosAjustes(d)), corDaLinha, `Fases da demanda ${escapar(d.id)}`)}
      <div class="pista-estado">${destaque(d, corDaLinha, agora)}</div>
    </div>
    ${estado === "em_execucao" ? rodadas(d) : ""}
    ${gaveta(d)}
  </div>`;
}

/**
 * O cabeçalho das colunas: as 5 etapas sobre as 11 estados, as de gate em âmbar. Fica fora da lista, que rola na
 * horizontal na janela estreita: dentro dela, deixaria de ficar fixo ao rolar a página (a montagem o acompanha).
 */
function cabeca(): string {
  const etapas = ETAPAS_DO_PROCESSO.map(
    ([nome, estados]) => `<div class="pista-etapa" style="grid-column: span ${String(estados)}">${nome}</div>`,
  );
  const estados = COLUNAS.map(
    ({ rotulo, gate }) => `<div class="${gate ? "pista-coluna gate" : "pista-coluna"}">${rotulo}</div>`,
  );
  return `<div class="pista-cabeca"><div></div>${etapas.join("")}<div></div><div></div>${estados.join("")}<div></div></div>`;
}

/** O seletor de projeto das duas abas; trocar de projeto leva à mesma aba do outro. */
export const seletor = (projetos: readonly ProjetoListado[], nome: string): string =>
  `<select class="seletor" aria-label="Projeto" data-projeto>${projetos
    .map((p) => `<option${p.nome === nome ? " selected" : ""}>${escapar(p.nome)}</option>`)
    .join("")}</select>`;

/** As abas da página do projeto: links de verdade, com a ativa marcada. */
export function abas(nome: string, ativa: "demandas" | "heatmap"): string {
  const aba = (id: typeof ativa, href: string, rotulo: string) =>
    `<a href="${href}"${ativa === id ? ' aria-current="page"' : ""}>${rotulo}</a>`;
  const heatmap = `${caminhoDoProjeto(nome)}/heatmap`;
  return `<nav class="abas" aria-label="Abas do projeto">${aba("demandas", caminhoDoProjeto(nome), "Demandas")}${aba("heatmap", heatmap, "Heatmap")}</nav>`;
}

/** A página `/projects/:projeto`: o seletor, as abas, o mês corrente do projeto (`mes`) nos cards e as demandas. */
export function paginaDoProjeto(
  projetos: readonly ProjetoListado[],
  nome: string,
  { demandas, contagem }: ListaDoProjeto,
  mes: MetricasMesDemanda,
  escolhas: Escolhas,
  agora: Date,
): string {
  const alternar = (chave: keyof Escolhas["mostrar"], rotulo: string) =>
    `<label class="alternar"><input type="checkbox" data-mostrar="${chave}"${escolhas.mostrar[chave] ? " checked" : ""}> ${rotulo}</label>`;
  return `<div class="seletor-linha"><h1>Projeto</h1>${seletor(projetos, nome)}<a class="editar" href="/config?projeto=${encodeURIComponent(nome)}">Editar na Configuração</a><a class="editar" href="${caminhoDoProjeto(nome)}/sdlc">Configuração SDLC</a></div>${abas(nome, "demandas")}${cardsDoMes(mes)}
  <div class="ferramentas">
    <span class="contagem">${String(contagem.andamento)} em andamento · ${plural(contagem.concluidas, "concluída", "concluídas")} · ${plural(contagem.arquivadas, "arquivada", "arquivadas")} · ${plural(contagem.canceladas, "cancelada", "canceladas")}</span>
    ${alternar("concluidas", "Mostrar concluídas")}
    ${alternar("arquivadas", "Mostrar arquivadas")}
    ${alternar("canceladas", "Mostrar canceladas")}
    <button type="button" class="btn btn-perigo direita" data-arquivar${contagem.concluidas === 0 ? " disabled" : ""}>Arquivar concluídas</button>
  </div>
  ${confirmacaoDeArquivar(contagem.concluidas, nome)}
  ${
    demandas.length > 0
      ? `<div class="pista-topo" aria-hidden="true">${cabeca()}</div><div class="pista-rola"><div class="pista">${demandas.map((d) => linha(d, escolhas, agora)).join("")}</div></div>`
      : '<p class="vazio">Nenhuma demanda.</p>'
  }`;
}
