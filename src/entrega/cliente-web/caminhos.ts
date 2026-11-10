// Caminhos do web (F7 §4.4): as páginas do cliente e o roteamento delas. O casamento de padrões é de `compartilhado`.
import { casar, type Parametros } from "../compartilhado/caminhos.ts";

export type Pagina =
  | "inicio"
  | "projeto"
  | "heatmap"
  | "metricas"
  | "historico"
  | "chat"
  | "configuracao"
  | "simulacao"
  | "sdlc"
  | "demandas"
  | "demanda"
  | "avaliacoes"
  | "avaliacao";

/**
 * As páginas do F7 §4.4. `/` e `/demandas` só redirecionam para `/home` (app.ts); `/projects` e `/simulation` sem nome
 * escolhem o projeto (ticket 29).
 */
const PAGINAS: readonly (readonly [string, Pagina])[] = [
  ["/home", "inicio"],
  ["/projects", "projeto"],
  ["/projects/:projeto", "projeto"],
  ["/projects/:projeto/heatmap", "heatmap"],
  ["/projects/:projeto/sdlc", "sdlc"],
  ["/projects/:projeto/demandas", "demandas"],
  ["/demandas/:demanda", "demanda"],
  ["/simulation", "simulacao"],
  ["/simulation/:projeto", "simulacao"],
  ["/metrics", "metricas"],
  ["/history", "historico"],
  ["/sessions/:sessao", "chat"],
  ["/evaluations", "avaliacoes"],
  ["/evaluations/:avaliacao", "avaliacao"],
  ["/config", "configuracao"],
];

interface Rota {
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
