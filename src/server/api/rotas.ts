// O contrato das rotas da API (F7 §4.2): uma linha por método e caminho. A rota só resolve a entrada, chama o F1/F4 e
// devolve o que vira JSON; a guarda, a leitura do corpo, a tradução dos erros e a tabela das rotas ficam no servidor.
// As rotas de cada tela importam daqui; este módulo não importa nenhuma delas.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { GestaoDeAmbientes } from "../../modulos/ambiente/publico.ts";
import type { MotivoDeRecusa } from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";
import type { ConfiguracaoDoAmbiente } from "../../shared/nucleo/configuracao_do_ambiente.ts";
import { Id } from "../../shared/nucleo/primitivos.ts";
import type { Relogio } from "../../shared/nucleo/relogio.ts";
import type { Parametros } from "../web/compartilhado/caminhos.ts";

/** O que o serviço expõe do agendador ao web (F4 §4). */
export interface Agendador {
  proximaBusca(): Date;
  /** O "Executar agora" (F4 §4) do ticket de uma demanda, que só o serviço sabe iniciar; devolve o motivo quando o Despacho o recusa. Opcional para os testes das outras rotas. */
  executarAgora?(ref: { demanda_id: string; ticket_id: number }): Promise<MotivoDeRecusa | undefined>;
}
/** O que o serviço expõe do Ambiente ao web: a gestão que ele montou e a gravação da Configuração com que a montou. */
export interface AmbientesDoServico {
  gestao: GestaoDeAmbientes;
  /** Grava a Configuração do Ambiente, já validada; a gestão a lê na pergunta seguinte. */
  configurar(configuracao: ConfiguracaoDoAmbiente): void;
}
export interface Pedido {
  banco: DatabaseSync;
  agendador: Agendador;
  ambientes: AmbientesDoServico;
  demandas: GestaoDeDemandas;
  relogio: Relogio;
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

interface RotaDaApi {
  metodo: "GET" | "POST" | "DELETE";
  /** Padrão do caminho, com `:parametro` por segmento (`casar`). */
  caminho: string;
  /** O valor devolvido sai como JSON 200; `undefined`, como 204. Erros saem pelo mapa do F7 §4.2. */
  tratar(pedido: Pedido): unknown;
}

/** Ou o schema zod do contrato da resposta 2xx (`contrato/`; o teste de rota confere o corpo por ele), ou o fluxo SSE (`text/event-stream`), que fica fora da conferência. */
export type Rota = RotaDaApi &
  ({ resposta: z.ZodType; fluxoSse?: undefined } | { fluxoSse: true; resposta?: undefined });

/** O schema da rota que não devolve JSON: 204, ou texto e arquivo que ela mesma escreve em `Pedido.resposta`. */
export const SemCorpoEmJson = z.undefined();

/** O ID de um `:parametro` do caminho. */
export const IdDoCaminho = z.coerce.number().pipe(Id);
