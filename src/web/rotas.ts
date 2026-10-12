// O contrato das rotas da API (F7 §4.2): uma linha por método e caminho. A rota só resolve a entrada, chama o F1/F4 e
// devolve o que vira JSON; a guarda, a leitura do corpo, a tradução dos erros e a tabela das rotas ficam no servidor.
// As rotas de cada tela importam daqui; este módulo não importa nenhuma delas.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Id } from "../dominio/primitivos.ts";
import type { Parametros } from "./cliente/caminhos.ts";

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

/** O ID de um `:parametro` do caminho. */
export const IdDoCaminho = z.coerce.number().pipe(Id);
