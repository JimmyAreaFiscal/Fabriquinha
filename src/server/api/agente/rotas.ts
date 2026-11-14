// As rotas de /api/agente/*: uma por comando do agente (`projeto ver`, `demanda ver`, `ticket ver`, `ticket criar`,
// `revisao decidir`, `evidencia schema`; o `evidencia add` é de evidencia.ts). Cada rota confere que o endereço pedido é do ticket do token
// antes de chamar o caso de uso de `aplicacao/agente`, que confere de novo; nenhuma regra mora aqui.
import type { z } from "zod";
import type { CicloDeVidaDoAgente } from "../../../modulos/ciclo_de_vida/publico.ts";
import type { Parametros } from "../../web/compartilhado/caminhos.ts";
import {
  type ErroDaApiDoAgente,
  PedidoRevisaoDecidir,
  PedidoTicketCriar,
  RespostaDemandaVer,
  RespostaEvidenciaSchema,
  RespostaProjetoVer,
  RespostaRevisaoDecidir,
  RespostaTicketCriar,
  RespostaTicketVer,
} from "../../contrato/agente/agente.ts";
import { demandaParaCli } from "../../contrato/agente/demanda_para_cli.ts";

export const PREFIXO_DA_API_DO_AGENTE = "/api/agente/";

/** O que a rota recebe: o Ciclo de Vida do agente que o token autenticou e o pedido já separado em caminho, query e corpo JSON. */
interface PedidoDoAgente {
  agente: CicloDeVidaDoAgente;
  params: Parametros;
  query: URLSearchParams;
  corpo: unknown;
}

export interface RotaDoAgente {
  metodo: "GET" | "POST";
  caminho: string;
  /** O schema do contrato do corpo 200; o teste de rota confere o corpo por ele. */
  resposta: z.ZodType;
  /** O corpo é binário e grande: `corpo` chega como o fluxo da requisição (`AsyncIterable<Buffer>`), sem ler. */
  corpoEmFluxo?: true;
  tratar(pedido: PedidoDoAgente): unknown;
}

/** O corpo do erro de qualquer rota: o texto do CLI do agente, numa linha só, e o código de saída 1. */
export const erroDaApiDoAgente = (mensagem: string): ErroDaApiDoAgente => ({
  mensagem: mensagem
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    .join(" "),
  codigo_de_saida: 1,
});

/** O texto da opção que o caso de uso espera: o valor já veio no corpo, então só a presença conta e o leitor devolve o valor. */
export const PRESENTE = "(no corpo)";

/** O `ticket` da query, se veio. */
const ticketDaQuery = (query: URLSearchParams): { ticket?: string } => {
  const ticket = query.get("ticket");
  return ticket === null ? {} : { ticket };
};

export function rotasDoAgente(): RotaDoAgente[] {
  return [
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}projeto`,
      resposta: RespostaProjetoVer,
      tratar: ({ agente, query }) => agente.andamento({ de: "projeto", ...ticketDaQuery(query) }),
    },
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}demandas/:demanda`,
      resposta: RespostaDemandaVer,
      tratar: ({ agente, params }) => {
        const visao = agente.andamento({ de: "demanda", demanda: String(params.demanda) });
        return { ...visao, demanda: demandaParaCli(visao.demanda) };
      },
    },
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}tickets/:ticket`,
      resposta: RespostaTicketVer,
      tratar: ({ agente, params }) => agente.andamento({ de: "ticket", ticket: String(params.ticket) }),
    },
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}tickets`,
      resposta: RespostaTicketCriar,
      tratar: ({ agente, corpo }) => {
        const { rodada, titulo } = PedidoTicketCriar.parse(corpo);
        return agente.criarTicketCorretivo({ rodada, titulo });
      },
    },
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}revisoes`,
      resposta: RespostaRevisaoDecidir,
      tratar: ({ agente, corpo }) => {
        const pedido = PedidoRevisaoDecidir.parse(corpo);
        const { correcoes, plano } = pedido;
        const jsonPorOpcao: Record<string, unknown> = { "--correcoes": correcoes, "--plano": plano };
        return agente.decidirRevisao(
          {
            ...pedido,
            correcoes: correcoes === undefined ? undefined : PRESENTE,
            plano: plano === undefined ? undefined : PRESENTE,
          },
          (_, opcao) => Promise.resolve(jsonPorOpcao[String(opcao)]),
        );
      },
    },
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}evidencias/:tipo/schema`,
      resposta: RespostaEvidenciaSchema,
      tratar: ({ agente, params, query }) => agente.schemaDaEvidencia(String(params.tipo), ticketDaQuery(query).ticket),
    },
  ];
}
