// Peças comuns do cliente (F7 §4.4) como funções puras que devolvem HTML: a navegação fixa, a página não encontrada e
// os formatos que mais de uma tela usa (rótulos, caminhos, datas, números). O texto que vem do servidor passa sempre
// por `escapar`.
import type { EstadoTicket, Instante, Modelo, ModoTrabalho } from "../../compartilhado/nucleo/primitivos.ts";
import type { Pagina } from "../caminhos.ts";

/** O status do ticket (F1 §3.5) como as telas o mostram. */
const NOME_DO_ESTADO_DO_TICKET: Record<EstadoTicket, string> = {
  aberto: "aberto",
  em_execucao: "em execução",
  concluido: "concluído",
  falhou: "falhou",
  cancelado: "cancelado",
};

/** O status do ticket como as telas o mostram: o `em_execucao` separa o pi rodando do sistema (testes, CI, espera). */
export const nomeDoEstadoDoTicket = (estado: EstadoTicket, piAtivo = false): string => {
  if (estado !== "em_execucao") return NOME_DO_ESTADO_DO_TICKET[estado];
  return piAtivo ? "sessão pi ativa" : "em execução (sistema)";
};

/** O status do ticket com inicial maiúscula (Sessão pi ativa), para a página e o quadro das demandas. */
export const rotuloDoEstadoDoTicket = (estado: EstadoTicket, piAtivo = false): string => {
  const rotulo = nomeDoEstadoDoTicket(estado, piAtivo);
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
};

/** A cor do status do ticket, nas pílulas comuns; em execução não pulsa, porque o ticket pode estar parado à espera. */
const PILULA_DO_ESTADO_DO_TICKET: Record<EstadoTicket, string> = {
  aberto: "pill-neutro",
  em_execucao: "pill-rodando sem-pulso",
  concluido: "pill-ok",
  falhou: "pill-falha",
  cancelado: "pill-neutro",
};

/** A pílula do status: só o pi rodando pulsa; o `em_execucao` sem pi pode estar parado à espera. */
export const pilulaDoEstadoDoTicket = (estado: EstadoTicket, piAtivo = false): string =>
  estado === "em_execucao" && piAtivo ? "pill-rodando" : PILULA_DO_ESTADO_DO_TICKET[estado];

/** O modo da sessão (F4 §5.1), no feminino de "sessão autônoma". */
export const MODO_DA_SESSAO: Record<ModoTrabalho, string> = {
  autonomo: "autônoma",
  interativo: "interativa",
  consulta: "consulta",
};

export const escapar = (texto: unknown): string =>
  String(texto).replaceAll(/[&<>"']/g, (c) => `&#${String(c.codePointAt(0))};`);

export const caminhoDaDemanda = (demanda: string): string => `/demandas/${encodeURIComponent(demanda)}`;
export const caminhoDaSessao = (sessao: string): string => `/sessions/${encodeURIComponent(sessao)}`;
export const caminhoDaAvaliacao = (avaliacao: string): string => `/evaluations/${encodeURIComponent(avaliacao)}`;

/** `anthropic / claude-opus-4-5`. */
export const nomeDoModelo = (m: Modelo): string => `${m.provedor} / ${m.nome}`;

/** O nome do modelo na página: numa linha só, cortado com reticências se faltar espaço, e inteiro no `title`. */
export const rotuloDoModelo = (nome: string): string =>
  `<span class="modelo" title="${escapar(nome)}">${escapar(nome)}</span>`;

/** O valor de um seletor de modelo (`provedor/nome`) como o corpo de C20, ou `null` para o padrão da etapa. */
export function modeloDoSeletor(valor: string): Modelo | null {
  const corte = valor.indexOf("/");
  return corte > 0 ? { provedor: valor.slice(0, corte), nome: valor.slice(corte + 1) } : null;
}

/** `1 falha`, `3 falhas`; o número passa por `formato`. */
export const plural = (n: number, um: string, varios: string, formato: (n: number) => string = String): string =>
  `${formato(n)} ${n === 1 ? um : varios}`;

const FORMATO_DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** `09/10`, no fuso do navegador. */
export const diaMes = (instante: Instante): string => FORMATO_DIA_MES.format(Date.parse(instante));
/** `09:05`, no fuso do navegador. */
export const hora = (instante: Instante): string => FORMATO_HORA.format(Date.parse(instante));
/** `48 s`, `2 min 10 s`, `34 min`, `1 h 20 min`. */
export function duracao(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)} s`;
  const [min, resto] = [Math.floor(s / 60), s % 60];
  if (min < 60) return resto ? `${String(min)} min ${String(resto)} s` : `${String(min)} min`;
  const [h, m] = [Math.floor(min / 60), min % 60];
  return m ? `${String(h)} h ${String(m)} min` : `${String(h)} h`;
}

export const custo = (valor: number): string =>
  `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `2,3 M`, `48,1 mil` ou `950`; a média fracionária abaixo de mil sai arredondada. */
export function compacto(n: number): string {
  const fmt = (v: number, casas: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  if (n >= 1e6) return `${fmt(n / 1e6, 1)} M`;
  return n >= 1e3 ? `${fmt(n / 1e3, 1)} mil` : fmt(n, 0);
}

/**
 * Há quanto tempo, em minutos ou horas e minutos. A duração tem espaços não separáveis: numa coluna estreita ela
 * desce inteira para a linha de baixo, e "1 min" nunca se separa.
 */
export function ha(desde: Instante, agora: number | Date): string {
  const minutos = Math.floor((Number(agora) - Date.parse(desde)) / 60_000);
  let tempo = `${String(Math.floor(minutos / 60))} h ${String(minutos % 60)} min`;
  if (minutos < 1) tempo = "menos de 1 min";
  else if (minutos < 60) tempo = `${String(minutos)} min`;
  return `há ${tempo.replaceAll(" ", "\u00a0")}`;
}

/** Navegação fixa: caminho, rótulo e as páginas em que o item fica marcado; a demanda se abre pelo board do Início. */
const NAVEGACAO: readonly (readonly [string, string, readonly Pagina[]])[] = [
  ["/home", "Início", ["inicio", "demanda"]],
  ["/projects", "Projetos", ["projeto", "heatmap", "sdlc", "demandas"]],
  ["/simulation", "Simulação", ["simulacao"]],
  ["/metrics", "Métricas", ["metricas"]],
  ["/history", "Histórico", ["historico"]],
  ["/evaluations", "Avaliações", ["avaliacoes", "avaliacao"]],
  ["/config", "Configuração", ["configuracao"]],
];

/** O conteúdo de `<header class="nav">`: a marca e os itens, com o número do que aguarda o Auditor no Início. */
export function navegacao(pagina: Pagina | undefined, aguardando: number): string {
  const itens = NAVEGACAO.map(([href, rotulo, paginas]) => {
    const atual = pagina !== undefined && paginas.includes(pagina) ? ' aria-current="page"' : "";
    const contador =
      href === "/home" && aguardando > 0
        ? ` <span class="contador" title="o que aguarda você">${String(aguardando)}</span>`
        : "";
    return `<a href="${href}"${atual}>${rotulo}${contador}</a>`;
  });
  return `<span class="marca">Fabriquinha</span><nav aria-label="Páginas">${itens.join("")}</nav>`;
}

/** O título de cada página, no cabeçalho e no `<title>`. */
export const TITULOS: Record<Pagina, string> = {
  inicio: "Início",
  projeto: "Projetos",
  heatmap: "Heatmap",
  metricas: "Métricas",
  historico: "Histórico",
  chat: "Chat",
  configuracao: "Configuração",
  simulacao: "Simulação",
  sdlc: "Configuração SDLC",
  demandas: "Demandas",
  demanda: "Demanda",
  avaliacoes: "Avaliações",
  avaliacao: "Avaliação",
};

export const NAO_ENCONTRADA =
  '<div class="cabeca-pagina"><h1>Página não encontrada</h1></div><p class="muted">Este endereço não é de nenhuma página da Fabriquinha. <a class="link" href="/home">Ir para o Início</a></p>';
