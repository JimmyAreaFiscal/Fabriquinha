// As rotas de /api/agente/*: uma por comando do agente (`projeto ver`, `demanda ver`, `ticket ver`, `ticket criar`,
// `revisao decidir`, `evidencia schema`; o `evidencia add` é de evidencia.ts). Cada rota confere que o endereço pedido é do ticket do token
// antes de chamar o caso de uso de `aplicacao/agente`, que confere de novo; nenhuma regra mora aqui.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { decidirRevisao } from "../../../etapas/agente/decidir_revisao.ts";
import { criarTicketCorretivo } from "../../../etapas/agente/criar_ticket_corretivo.ts";
import { verDemanda, verProjeto, verTicket } from "../../../etapas/agente/consultas.ts";
import { adicionarEvidenciaComAnexosEnviados } from "../../../etapas/agente/adicionar_evidencia.ts";
import {
  type EscopoDoAgente,
  exigirDemandaPropria,
  exigirTicketProprio,
  type ProcessoDoAgente,
} from "../../../etapas/agente/escopo.ts";
import { tipoDoAgente } from "../../../etapas/agente/tipo_do_agente.ts";
import { ErroDeEscopo } from "../../../compartilhado/nucleo/erros.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { Relogio } from "../../../compartilhado/nucleo/relogio.ts";
import type { Parametros } from "../../compartilhado/caminhos.ts";
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
} from "../../contrato/agente.ts";
import { demandaParaCli } from "../../contrato/demanda_para_cli.ts";

export const PREFIXO_DA_API_DO_AGENTE = "/api/agente/";

/** O que a rota recebe: o agente que o token autenticou e o pedido já separado em caminho, query e corpo JSON. */
interface PedidoDoAgente {
  banco: DatabaseSync;
  relogio: Relogio;
  agente: EscopoDoAgente;
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

/** Os casos de uso que as rotas chamam; os testes trocam por espiões para provar que o pedido recusado nem chega a eles. */
export const CASOS_DE_USO_DO_AGENTE = {
  verProjeto,
  verDemanda,
  verTicket,
  criarTicketCorretivo,
  decidirRevisao,
  adicionarEvidencia: adicionarEvidenciaComAnexosEnviados,
};
export type CasosDeUsoDoAgente = typeof CASOS_DE_USO_DO_AGENTE;

export const processoDoAgente = (agente: EscopoDoAgente): ProcessoDoAgente => ({ id: agente.ator.trabalho_id });

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

/** `GET` sem endereço: o `ticket` da query, se vier, tem de ser o do token. */
function exigirTicketDaQueryProprio(agente: EscopoDoAgente, query: URLSearchParams): void {
  const ticket = query.get("ticket");
  if (ticket !== null) exigirTicketProprio(agente, ticket);
}

/** A rodada de outra demanda é recusada aqui; o endereço malformado segue para o caso de uso, que mostra a forma certa. */
function exigirRodadaDaPropriaDemanda(agente: EscopoDoAgente, rodada: string): void {
  let demanda;
  try {
    demanda = Endereco.ler(rodada).demanda_id;
  } catch {
    return;
  }
  if (demanda !== agente.demanda_id) {
    throw new ErroDeEscopo(`${rodada} é de outra demanda`, `use uma rodada de ${agente.demanda_id}`);
  }
}

export function rotasDoAgente(casos: CasosDeUsoDoAgente = CASOS_DE_USO_DO_AGENTE): RotaDoAgente[] {
  return [
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}projeto`,
      resposta: RespostaProjetoVer,
      tratar: ({ banco, agente, query }) => {
        exigirTicketDaQueryProprio(agente, query);
        return casos.verProjeto(banco, processoDoAgente(agente));
      },
    },
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}demandas/:demanda`,
      resposta: RespostaDemandaVer,
      tratar: ({ banco, agente, params }) => {
        exigirDemandaPropria(agente, String(params.demanda));
        const visao = casos.verDemanda(banco, processoDoAgente(agente), String(params.demanda));
        return { ...visao, demanda: demandaParaCli(visao.demanda) };
      },
    },
    {
      metodo: "GET",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}tickets/:ticket`,
      resposta: RespostaTicketVer,
      tratar: ({ banco, agente, params }) => {
        exigirTicketProprio(agente, String(params.ticket));
        return casos.verTicket(banco, processoDoAgente(agente), String(params.ticket));
      },
    },
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}tickets`,
      resposta: RespostaTicketCriar,
      tratar: ({ banco, relogio, agente, corpo }) => {
        const pedido = PedidoTicketCriar.parse(corpo);
        exigirRodadaDaPropriaDemanda(agente, pedido.rodada);
        return casos.criarTicketCorretivo(
          banco,
          processoDoAgente(agente),
          { rodada: pedido.rodada, titulo: pedido.titulo },
          relogio,
        );
      },
    },
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}revisoes`,
      resposta: RespostaRevisaoDecidir,
      tratar: ({ banco, agente, corpo }) => {
        const pedido = PedidoRevisaoDecidir.parse(corpo);
        exigirTicketProprio(agente, pedido.ticket, true);
        const { correcoes, plano } = pedido;
        const jsonPorOpcao: Record<string, unknown> = { "--correcoes": correcoes, "--plano": plano };
        return casos.decidirRevisao(
          banco,
          processoDoAgente(agente),
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
      tratar: ({ agente, params, query }) => {
        exigirTicketDaQueryProprio(agente, query);
        const { dados, arquivos } = tipoDoAgente(String(params.tipo)).schema;
        return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
      },
    },
  ];
}
