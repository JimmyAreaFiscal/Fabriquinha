// Ações do Auditor sobre as demandas (comparacao-sdlc §9.1): os gates (demanda, planejamento, PR da rodada) e a sessão
// de ajustes. Cada rota valida o corpo, chama o serviço da aplicação como AUDITOR e devolve o erro dele como está.
import { Endereco, type RefRodada } from "../../../../modulos/ciclo_de_vida/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { cancelarDemandaEmCascata, decidirGateDaDemanda } from "./cancelamento_em_cascata.ts";
import {
  DecisaoDoPR,
  DemandaArquivada,
  DemandaComCanceladas,
  DemandaEmJson,
  ReaberturaDoTicket,
  TicketReaberto,
} from "../contrato/demanda.ts";
import { MotivoDeRecusaEmJson } from "../contrato/despacho.ts";
import type { Pedido, Rota } from "../rotas.ts";
import { recusaEmJson } from "../inicio/inicio.ts";

/** O `:ref` do caminho como rodada (`I-206.R2`). */
function refDaRodada({ params }: Pedido): RefRodada {
  const { demanda_id, rodada_id } = Endereco.ler(String(params.ref));
  if (rodada_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é uma rodada`, "use o endereço da rodada, como I-206.R2");
  return { demanda_id, rodada_id };
}

/** O corpo é a entrada do gate (`resultado`, `nota` e `motivo`): quem valida é o gate. */
const decisaoDaDemanda = ({ cicloDeVida, demandas, params, corpo }: Pedido) =>
  decidirGateDaDemanda(cicloDeVida, demandas, String(params.id), corpo);

async function decisaoDoPlanejamento({ cicloDeVida, params, corpo }: Pedido) {
  const decidida = await cicloDeVida.decidir({ gate: "gate_planejamento", demanda: String(params.id), entrada: corpo });
  return decidida.demanda;
}

const decisaoDoPR = async (pedido: Pedido) => {
  const decidida = await pedido.cicloDeVida.decidir({
    gate: "gate_pr",
    rodada: refDaRodada(pedido),
    entrada: pedido.corpo,
  });
  return decidida.sessao === undefined ? decidida.demanda : { sessao: decidida.sessao };
};

const concluir = async (pedido: Pedido) => {
  const decidida = await pedido.cicloDeVida.decidir({ gate: "ajustes_concluidos", rodada: refDaRodada(pedido) });
  return decidida.demanda;
};

/** O `:ref` do caminho como ticket (`I-206.T3`). */
function refDoTicket({ params }: Pedido) {
  const { demanda_id, ticket_id } = Endereco.ler(String(params.ref));
  if (ticket_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é um ticket`, "use o endereço do ticket, como I-206.T3");
  return { demanda_id, ticket_id };
}

function reabertura(pedido: Pedido) {
  const { instrucao } = ReaberturaDoTicket.parse(pedido.corpo);
  return { ticket: pedido.cicloDeVida.reabrir(refDoTicket(pedido), instrucao) };
}

/** Aceito, responde 204; recusado pelo Despacho, responde o `MotivoDeRecusa`. */
function executar(pedido: Pedido): unknown {
  const recusa = pedido.cicloDeVida.executarAgora(refDoTicket(pedido));
  return recusa && recusaEmJson(recusa);
}

const cancelamento = ({ cicloDeVida, demandas, params }: Pedido) =>
  cancelarDemandaEmCascata(cicloDeVida, demandas, String(params.id));
const arquivamento = ({ cicloDeVida, params }: Pedido) => ({ demanda: cicloDeVida.arquivar([String(params.id)])[0] });

export const ROTAS_DAS_ACOES_DE_DEMANDA: Rota[] = [
  { metodo: "POST", caminho: "/api/demandas/:id/decisao", tratar: decisaoDaDemanda, resposta: DemandaComCanceladas },
  {
    metodo: "POST",
    caminho: "/api/demandas/:id/planejamento/decisao",
    tratar: decisaoDoPlanejamento,
    resposta: DemandaEmJson,
  },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/pr", tratar: decisaoDoPR, resposta: DecisaoDoPR },
  {
    metodo: "POST",
    caminho: "/api/demandas/rodadas/:ref/ajustes/concluir",
    tratar: concluir,
    resposta: DemandaEmJson,
  },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/reabrir", tratar: reabertura, resposta: TicketReaberto },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/executar", tratar: executar, resposta: MotivoDeRecusaEmJson },
  { metodo: "POST", caminho: "/api/demandas/:id/cancelar", tratar: cancelamento, resposta: DemandaComCanceladas },
  { metodo: "POST", caminho: "/api/demandas/:id/arquivar", tratar: arquivamento, resposta: DemandaArquivada },
];
