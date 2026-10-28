// Peças comuns do cliente (F7 §4.4) como funções puras que devolvem HTML: a navegação fixa, a página não encontrada e
// os formatos que mais de uma tela usa (rótulos, caminhos, datas, números). O texto que vem do servidor passa sempre
// por `escapar`.
import type { ModoExecucao, Ticket } from "../../dominio/agregado.ts";
import type { FaseDemanda, FaseRodada, Modelo } from "../../dominio/primitivos.ts";
import type { Pagina } from "./caminhos.ts";

/** O status do ticket (F1 §3.5) como as telas o mostram. */
export const STATUS_DO_TICKET: Record<Ticket["status"], string> = {
  aberto: "aberto",
  em_execucao: "em execução",
  concluido: "concluído",
  falhou: "falhou",
  fechado: "fechado",
  cancelado: "cancelado",
};

/** O status do ticket com inicial maiúscula (Em execução), para a página e o quadro das demandas. */
export const rotuloDoStatus = (status: Ticket["status"]): string =>
  STATUS_DO_TICKET[status].charAt(0).toUpperCase() + STATUS_DO_TICKET[status].slice(1);

/** A fase da demanda e a da rodada (comparacao-sdlc §2.1) como as telas as mostram, com a cor da pílula. */
export const FASE_DA_DEMANDA: Record<FaseDemanda, [rotulo: string, pilula: string]> = {
  registro: ["Registro", "pill-neutro"],
  aprovacao_demanda: ["Aprovação da demanda", "pill-aguarda"],
  planejamento: ["Planejamento", "pill-rodando"],
  aprovacao_planejamento: ["Aprovação do planejamento", "pill-aguarda"],
  execucao: ["Execução", "pill-rodando"],
  revisao_demanda: ["Revisão da demanda", "pill-rodando"],
  encerramento: ["Encerramento", "pill-rodando"],
  concluida: ["Concluída", "pill-ok"],
  arquivada: ["Arquivada", "pill-neutro"],
  cancelada: ["Cancelada", "pill-cancelada"],
};
export const FASE_DA_RODADA: Record<FaseRodada, [rotulo: string, pilula: string]> = {
  desenvolvimento: ["Desenvolvimento", "pill-rodando"],
  revisao: ["Revisão", "pill-rodando"],
  encerramento: ["Encerramento", "pill-rodando"],
  aprovacao_pull_request: ["Aprovação do PR", "pill-aguarda"],
  sessao: ["Sessão de ajustes", "pill-aguarda"],
  concluida: ["Concluída", "pill-ok"],
};

/** A cor do status do ticket, nas pílulas comuns; em execução não pulsa, porque o ticket pode estar parado à espera. */
export const PILULA_DO_STATUS: Record<Ticket["status"], string> = {
  aberto: "pill-neutro",
  em_execucao: "pill-rodando sem-pulso",
  concluido: "pill-ok",
  falhou: "pill-falha",
  fechado: "pill-neutro",
  cancelado: "pill-neutro",
};

/** O modo da sessão (F4 §5.1), no feminino de "sessão autônoma". */
export const MODO_DA_SESSAO: Record<ModoExecucao, string> = {
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
export const nomeDoModelo = (m: Modelo): string => `${m.provedor} / ${m.modelo}`;

/** O nome do modelo na página: numa linha só, cortado com reticências se faltar espaço, e inteiro no `title`. */
export const rotuloDoModelo = (nome: string): string =>
  `<span class="modelo" title="${escapar(nome)}">${escapar(nome)}</span>`;

/** O valor de um seletor de modelo (`provedor/modelo`) como o corpo de C20, ou `null` para o padrão da etapa. */
export function modeloDoSeletor(valor: string): Modelo | null {
  const corte = valor.indexOf("/");
  return corte > 0 ? { provedor: valor.slice(0, corte), modelo: valor.slice(corte + 1) } : null;
}

/** `1 falha`, `3 falhas`; o número passa por `formato`. */
export const plural = (n: number, um: string, varios: string, formato: (n: number) => string = String): string =>
  `${formato(n)} ${n === 1 ? um : varios}`;

const dois = (n: number): string => String(n).padStart(2, "0");
/** `09/10`, no fuso do navegador. */
export const diaMes = (d: Date): string => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
/** `09:05`, no fuso do navegador. */
export const hora = (d: Date): string => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
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

/** Navegação fixa: caminho, rótulo e as páginas em que o item fica marcado. */
const NAVEGACAO: readonly (readonly [string, string, readonly Pagina[]])[] = [
  ["/projects", "Projetos", ["projeto", "heatmap", "sdlc"]],
  ["/demandas", "Demandas", ["demandas", "demanda"]],
  ["/simulation", "Simulação", ["simulacao"]],
  ["/metrics", "Métricas", ["metricas"]],
  ["/history", "Histórico", ["historico"]],
  ["/evaluations", "Avaliações", ["avaliacoes", "avaliacao"]],
  ["/config", "Configuração", ["configuracao"]],
];

/** O conteúdo de `<header class="nav">`: a marca e os itens, com o número de sessões que aguardam o Auditor. */
export function navegacao(pagina: Pagina | undefined, aguardando: number): string {
  const itens = NAVEGACAO.map(([href, rotulo, paginas]) => {
    const atual = pagina !== undefined && paginas.includes(pagina) ? ' aria-current="page"' : "";
    const contador =
      href === "/demandas" && aguardando > 0
        ? ` <span class="contador" title="sessões que aguardam você">${String(aguardando)}</span>`
        : "";
    return `<a href="${href}"${atual}>${rotulo}${contador}</a>`;
  });
  return `<span class="marca">Fabriquinha</span><nav aria-label="Páginas">${itens.join("")}</nav>`;
}

/** O título de cada página, no cabeçalho e no `<title>`. */
export const TITULOS: Record<Pagina, string> = {
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
  '<div class="cabeca-pagina"><h1>Página não encontrada</h1></div><p class="muted">Este endereço não é de nenhuma página da Fabriquinha. <a class="link" href="/demandas">Ir para as Demandas</a></p>';
