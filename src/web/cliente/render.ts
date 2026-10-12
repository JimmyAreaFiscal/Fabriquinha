// Peças comuns do cliente (F7 §4.4) como funções puras que devolvem HTML: navegação fixa, trilho de fases e as
// páginas ainda vazias. O texto que vem do servidor passa sempre por `escapar`.
import type { Fase } from "../../dominio/primitivos.ts";
import type { Pagina } from "./caminhos.ts";

export const escapar = (texto: unknown): string =>
  String(texto).replaceAll(/[&<>"']/g, (c) => `&#${String(c.codePointAt(0))};`);

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
const FASES = [
  ["registro", "Registro"],
  ["desenho", "Desenho"],
  ["aprovacao_desenho", "Aprovação do desenho"],
  ["desenvolvimento", "Desenvolvimento"],
  ["revisao", "Revisão"],
  ["encerramento", "Encerramento"],
  ["aprovacao_pr", "Aprovação do PR"],
  ["ajuste_pr", "Ajuste do PR"],
] as const satisfies readonly (readonly [Exclude<Fase, "concluida">, string])[];

const GATES: ReadonlySet<Fase> = new Set(["aprovacao_desenho", "aprovacao_pr"]);

/** Como está a sessão da fase atual: dá a cor do marco (âmbar, vermelho, azul). */
export type EstadoDoTrilho = "aguarda" | "falha" | "rodando";

/**
 * Trilho de fases: passadas em verde, a atual maior e com a cor do estado, as de gate em losango. Numa issue
 * `concluida`, todas estão passadas.
 */
export function trilho(fase: Fase, estado?: EstadoDoTrilho): string {
  const atual = fase === "concluida" ? FASES.length : FASES.findIndex(([f]) => f === fase);
  const passos = FASES.map(([f, rotulo], i) => {
    const classes = ["passo", GATES.has(f) && "gate", i < atual && "feito", i === atual && "atual"];
    const corrente = i === atual ? ' aria-current="step"' : "";
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
