// Rotas da API (F7 §4.2): uma linha por método e caminho. A rota só resolve a entrada, chama o F1/F4 e devolve o que
// vira JSON; a guarda, a leitura do corpo e a tradução dos erros ficam no servidor.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Id } from "../dominio/primitivos.ts";
import type { Parametros } from "./cliente/caminhos.ts";
import { ROTAS_DO_CHAT } from "./rotas/chat.ts";
import { ROTAS_DA_CONFIGURACAO } from "./rotas/configuracao.ts";
import { ROTAS_DO_DESENHO } from "./rotas/desenho.ts";
import { ROTAS_DO_HISTORICO } from "./rotas/historico.ts";
import { ROTAS_DO_INICIO } from "./rotas/inicio.ts";
import { ROTAS_DA_ISSUE } from "./rotas/issue.ts";
import { ROTAS_DAS_METRICAS } from "./rotas/metricas.ts";
import { ROTAS_DO_PR } from "./rotas/pr.ts";
import { ROTAS_DO_PROJETO } from "./rotas/projeto.ts";

/** O que o serviço expõe do agendador ao web (F4 §4). */
export interface Agendador {
  proximaBusca(): Date;
  /** O "Executar agora" (F4 §4), que só o serviço sabe iniciar. */
  executarAgora(ticket: Id): Promise<void>;
}
export interface Pedido {
  banco: DatabaseSync;
  agendador: Agendador;
  /** Os `:parametros` do caminho, decodificados. */
  params: Parametros;
  query: URLSearchParams;
  /** O JSON do corpo de uma mutação, ainda sem schema; `undefined` num `GET` ou com corpo vazio. */
  corpo: unknown;
  /** Os cabeçalhos do pedido (o `Range` de um arquivo, por exemplo). */
  cabecalhos: IncomingHttpHeaders;
  /** Para a rota que responde fora do JSON (texto, download, SSE); depois que ela responde, o servidor não mexe. */
  resposta: ServerResponse;
}

export interface Rota {
  metodo: "GET" | "POST" | "DELETE";
  /** Padrão do caminho, com `:parametro` por segmento (`casar`). */
  caminho: string;
  /** O valor devolvido sai como JSON 200; `undefined`, como 204. Erros saem pelo mapa do F7 §4.2. */
  tratar(pedido: Pedido): unknown;
}

export const ROTAS: Rota[] = [
  ...ROTAS_DO_HISTORICO,
  ...ROTAS_DA_CONFIGURACAO,
  ...ROTAS_DA_ISSUE,
  ...ROTAS_DO_CHAT,
  ...ROTAS_DO_DESENHO,
  ...ROTAS_DO_PR,
  ...ROTAS_DO_INICIO,
  ...ROTAS_DO_PROJETO,
  ...ROTAS_DAS_METRICAS,
];
