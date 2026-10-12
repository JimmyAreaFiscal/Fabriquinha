// Peças comuns do cliente (F7 §4.4) como funções puras que devolvem HTML: navegação fixa, trilho de fases, as páginas
// ainda vazias e os formatos que mais de uma tela usa (rótulos, caminhos, datas, números). O texto que vem do servidor
// passa sempre por `escapar`.
import type { ModoExecucao, Ticket } from "../../dominio/agregado.ts";
import type { Etapa, Fase, Id, Modelo } from "../../dominio/primitivos.ts";
import type { InfoSessao, MotivoEspera } from "../../execucao/sessoes.ts";
import type { Pagina } from "./caminhos.ts";

/** O status do ticket (F1 §3.5) como as telas o mostram. */
export const STATUS_DO_TICKET: Record<Ticket["status"], string> = {
  aberto: "aberto",
  em_execucao: "em execução",
  concluido: "concluído",
  falhou: "falhou",
};

/** A cor do status do ticket, nas pílulas comuns; em execução não pulsa, porque o ticket pode estar parado à espera. */
export const PILULA_DO_STATUS: Record<Ticket["status"], string> = {
  aberto: "pill-neutro",
  em_execucao: "pill-rodando sem-pulso",
  concluido: "pill-ok",
  falhou: "pill-falha",
};

/** O modo da sessão (F4 §5.1), no feminino de "sessão autônoma". */
export const MODO_DA_SESSAO: Record<ModoExecucao, string> = {
  autonomo: "autônoma",
  interativo: "interativa",
  consulta: "consulta",
};

/** A etapa do ticket (F1), como título; `etapa()` a dá no meio da frase. */
export const NOME_DA_ETAPA: Record<Etapa, string> = {
  registro: "Registro",
  desenho: "Desenho",
  desenvolvimento: "Desenvolvimento",
  revisao: "Revisão",
  encerramento: "Encerramento",
  sessao: "Sessão em aberto",
};
export const etapa = (e: Etapa): string => NOME_DA_ETAPA[e].toLowerCase();

/** Por motivo da espera (F4 §5.2): o destaque do card, a marca no cartão do board e o botão (F7 §4.4). */
export const MOTIVOS: Record<MotivoEspera, { titulo: string; marca: string; acao: string }> = {
  conversa: { titulo: "Conversa", marca: "responder", acao: "Responder" },
  dialogo: { titulo: "Diálogo", marca: "responder", acao: "Responder" },
  falha: { titulo: "Falhou", marca: "falha", acao: "Responder e retomar" },
  gate_registro: { titulo: "Gate do registro", marca: "gate do registro", acao: "Avaliar registro" },
  gate_desenho: { titulo: "Gate do desenho", marca: "gate do desenho", acao: "Avaliar desenho" },
  gate_pr: { titulo: "Gate do PR", marca: "gate do PR", acao: "Ver o PR" },
};

export const escapar = (texto: unknown): string =>
  String(texto).replaceAll(/[&<>"']/g, (c) => `&#${String(c.codePointAt(0))};`);

export const rotuloIssue = (id: Id): string => `I-${String(id)}`;
export const rotuloTicket = (id: Id): string => `T-${String(id)}`;

export const caminhoDaIssue = (projeto: string, issue: Id): string =>
  `/projects/${encodeURIComponent(projeto)}/issues/${rotuloIssue(issue)}`;
export const caminhoDaSessao = (sessao: string): string => `/sessions/${encodeURIComponent(sessao)}`;

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
/** `11/10 09:00`, no fuso do navegador. */
export const data = (instante: string): string => `${diaMes(new Date(instante))} ${hora(new Date(instante))}`;

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
export function ha(desde: string, agora: Date): string {
  const minutos = Math.floor((agora.getTime() - Date.parse(desde)) / 60_000);
  let duracao = `${String(Math.floor(minutos / 60))} h ${String(minutos % 60)} min`;
  if (minutos < 1) duracao = "menos de 1 min";
  else if (minutos < 60) duracao = `${String(minutos)} min`;
  return `há ${duracao.replaceAll(" ", "\u00a0")}`;
}

/** Navegação fixa: caminho, rótulo e as páginas em que o item fica marcado. */
const NAVEGACAO: readonly (readonly [string, string, readonly Pagina[]])[] = [
  ["/home", "Início", ["inicio"]],
  ["/projects", "Projetos", ["projeto", "issue"]],
  ["/metrics", "Métricas", ["metricas"]],
  ["/history", "Histórico", ["historico"]],
  ["/config", "Configuração", ["configuracao"]],
];

/** O conteúdo de `<header class="nav">`: a marca e os itens, com o número de sessões que aguardam o Auditor. */
export function navegacao(pagina: Pagina | undefined, aguardando: number): string {
  const itens = NAVEGACAO.map(([href, rotulo, paginas]) => {
    const atual = pagina !== undefined && paginas.includes(pagina) ? ' aria-current="page"' : "";
    const contador =
      href === "/home" && aguardando > 0
        ? ` <span class="contador" title="sessões que aguardam você">${String(aguardando)}</span>`
        : "";
    return `<a href="${href}"${atual}>${rotulo}${contador}</a>`;
  });
  return `<span class="marca">Fabriquinha</span><nav aria-label="Páginas">${itens.join("")}</nav>`;
}

/** As 8 fases do trilho (F1, menos `concluida`), na ordem do processo. */
export const FASES = [
  ["registro", "Registro"],
  ["desenho", "Desenho"],
  ["aprovacao_desenho", "Aprovação do desenho"],
  ["desenvolvimento", "Desenvolvimento"],
  ["revisao", "Revisão"],
  ["encerramento", "Encerramento"],
  ["aprovacao_pr", "Aprovação do PR"],
  ["ajuste_pr", "Ajuste do PR"],
] as const satisfies readonly (readonly [Exclude<Fase, "concluida">, string])[];

export const GATES: ReadonlySet<Fase> = new Set(["aprovacao_desenho", "aprovacao_pr"]);

/** Como está a sessão da fase atual: dá a cor do marco (âmbar, vermelho, azul). */
export type EstadoDoTrilho = "aguarda" | "falha" | "rodando";

/** A cor do marco atual no trilho: a falha antes de quem aguarda, e quem aguarda antes do que roda. */
export function estadoDoTrilho(sessoes: readonly InfoSessao[]): EstadoDoTrilho | undefined {
  if (sessoes.some((s) => s.motivo === "falha")) return "falha";
  if (sessoes.some((s) => s.estado === "aguardando_humano")) return "aguarda";
  return sessoes.some((s) => s.estado === "rodando") ? "rodando" : undefined;
}

/** As 5 etapas do processo sobre as colunas do board e do trilho, com quantas fases cada uma agrupa (F7 §4.4). */
export const ETAPAS_DO_PROCESSO: readonly (readonly [string, number])[] = [
  ["Registrar", 1],
  ["Desenhar", 2],
  ["Implementar", 1],
  ["Revisar", 1],
  ["Encerrar", 3],
];

/**
 * Como cada fase do trilho aparece: `feito` a passada, `atual` a atual, e `""` a que vem depois ou a que a issue pulou
 * (F7 §4.4: só a fase passada fica verde). `percorridas` são as fases em que a issue esteve (a tabela `comando`), porque
 * o ajuste do PR, por exemplo, só acontece com o PR reprovado. Numa issue `concluida`, não há atual.
 */
export function situacaoDasFases(
  fase: Fase,
  percorridas: readonly Fase[],
): { fase: Exclude<Fase, "concluida">; rotulo: string; situacao: "feito" | "atual" | "" }[] {
  const atual = fase === "concluida" ? FASES.length : FASES.findIndex(([f]) => f === fase);
  return FASES.map(([f, rotulo], i) => {
    if (i === atual) return { fase: f, rotulo, situacao: "atual" };
    return { fase: f, rotulo, situacao: i < atual && percorridas.includes(f) ? "feito" : "" };
  });
}

/** Trilho de fases: passadas em verde, a atual maior e com a cor do estado, as de gate em losango. */
export function trilho(fase: Fase, percorridas: readonly Fase[], estado?: EstadoDoTrilho): string {
  const passos = situacaoDasFases(fase, percorridas).map(({ fase: f, rotulo, situacao }) => {
    const classes = ["passo", GATES.has(f) && "gate", situacao];
    const corrente = situacao === "atual" ? ' aria-current="step"' : "";
    return `<li class="${classes.filter(Boolean).join(" ")}"${corrente}><span class="linha"><span class="marco"></span></span><span>${rotulo}</span></li>`;
  });
  return `<ol class="${["trilho-fases", estado].filter(Boolean).join(" ")}" aria-label="Fases da issue">${passos.join("")}</ol>`;
}

/** O título de cada página, no cabeçalho e no `<title>`. */
export const TITULOS: Record<Pagina, string> = {
  inicio: "Início",
  projeto: "Projetos",
  issue: "Issue",
  metricas: "Métricas",
  historico: "Histórico",
  chat: "Chat",
  configuracao: "Configuração",
};

/** Página ainda sem conteúdo: só o cabeçalho com o título. */
export const paginaVazia = (titulo: string): string => `<div class="cabeca-pagina"><h1>${escapar(titulo)}</h1></div>`;

export const NAO_ENCONTRADA =
  '<div class="cabeca-pagina"><h1>Página não encontrada</h1></div><p class="muted">Este endereço não é de nenhuma página da Fabriquinha. <a class="link" href="/home">Ir para o Início</a></p>';
