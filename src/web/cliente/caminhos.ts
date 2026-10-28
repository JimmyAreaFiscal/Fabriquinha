// Caminhos do web (F7 §4.4): o casamento de um padrão `/projects/:projeto` com o caminho pedido, usado pelo servidor
// nas rotas da API e pelo cliente nas páginas. Roda também no navegador: só importa tipos e arquivos desta pasta.

export type Parametros = Record<string, string>;

/** Os parâmetros de `caminho` se ele casa com `padrao`, cada um decodificado; senão, `undefined`. */
export function casar(padrao: string, caminho: string): Parametros | undefined {
  const literal = padrao.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const casou = new RegExp(`^${literal.replaceAll(/:(\w+)/g, "(?<$1>[^/]+)")}$`).exec(caminho);
  if (!casou) return undefined;
  try {
    return Object.fromEntries(
      Object.entries(casou.groups ?? {}).map(([nome, valor]) => [nome, decodeURIComponent(valor)]),
    );
  } catch {
    return undefined;
  }
}

export type Pagina =
  | "inicio"
  | "projeto"
  | "heatmap"
  | "issue"
  | "metricas"
  | "historico"
  | "chat"
  | "auditoria"
  | "configuracao"
  | "simulacao"
  | "sdlc"
  | "demandas"
  | "demanda"
  | "avaliacoes"
  | "avaliacao";

/** As páginas do F7 §4.4. `/` só redireciona para `/home`; `/projects` e `/simulation` sem nome escolhem o projeto (ticket 29). */
const PAGINAS: readonly (readonly [string, Pagina])[] = [
  ["/home", "inicio"],
  ["/projects", "projeto"],
  ["/projects/:projeto", "projeto"],
  ["/projects/:projeto/heatmap", "heatmap"],
  ["/projects/:projeto/sdlc", "sdlc"],
  ["/projects/:projeto/demandas", "demandas"],
  ["/demandas", "demandas"],
  ["/demandas/:demanda", "demanda"],
  ["/projects/:projeto/issues/:issue", "issue"],
  ["/simulation", "simulacao"],
  ["/simulation/:projeto", "simulacao"],
  ["/metrics", "metricas"],
  ["/history", "historico"],
  ["/sessions/:sessao", "chat"],
  ["/audits/:sessao", "auditoria"],
  ["/evaluations", "avaliacoes"],
  ["/evaluations/:avaliacao", "avaliacao"],
  ["/config", "configuracao"],
];

export interface Rota {
  pagina: Pagina;
  params: Parametros;
}

/** A página do caminho, ou `undefined` se nenhuma casa. */
export function rotear(caminho: string): Rota | undefined {
  for (const [padrao, pagina] of PAGINAS) {
    const params = casar(padrao, caminho);
    if (params) return { pagina, params };
  }
  return undefined;
}
