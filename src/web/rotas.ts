// Rotas da API (F7 §4.2): uma linha por método e caminho. A rota só resolve a entrada, chama o F1/F4 e devolve o que
// vira JSON; a guarda, a leitura do corpo e a tradução dos erros ficam no servidor.
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Etapa } from "../dominio/primitivos.ts";
import { sessoes } from "../execucao/sessoes.ts";
import type { Parametros } from "./cliente/caminhos.ts";

export interface Pedido {
  banco: DatabaseSync;
  /** Os `:parametros` do caminho, decodificados. */
  params: Parametros;
  query: URLSearchParams;
  /** O JSON do corpo de uma mutação, ainda sem schema; `undefined` num `GET` ou com corpo vazio. */
  corpo: unknown;
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

const FiltroSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  issue: z.coerce.number().int().positive().optional(),
  etapa: Etapa.optional(),
});

export const ROTAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: ({ banco, query }) => sessoes(banco, FiltroSessoes.parse(Object.fromEntries(query))),
  },
];
