// Ações do Auditor sobre as demandas (comparacao-sdlc §9.1): os gates (demanda, planejamento, PR da rodada) e a sessão
// de ajustes. Cada rota valida o corpo, chama o serviço da aplicação como AUDITOR e devolve o erro dele como está.
import { AUDITOR } from "../../../../modulos/compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeRegra } from "../../../../modulos/compartilhado/nucleo/erros.ts";
import { Endereco } from "../../../../modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { RefRodada } from "../../../../modulos/etapas/encerrar_rodada/encerramento_rodada.ts";
import { decidirGate } from "../../../../modulos/etapas/gates.ts";
import { arquivar, cancelar, reabrir } from "../../../../modulos/sdlc/aplicacao/gestao_demandas.ts";
import { concluirSessaoAjustes } from "../../../../modulos/etapas/ajustar_resultado/sessao_ajustes.ts";
import {
  DecisaoDoPR,
  DemandaArquivada,
  DemandaComCanceladas,
  DemandaEmJson,
  ReaberturaDoTicket,
  TicketReaberto,
} from "../../../contrato/demanda.ts";
import { MotivoDeRecusaEmJson } from "../../../contrato/despacho.ts";
import type { Pedido, Rota } from "../../rotas.ts";
import { recusaEmJson } from "../inicio.ts";

/** O `:ref` do caminho como rodada (`I-206.R2`). */
function refDaRodada({ params }: Pedido): RefRodada {
  const { demanda_id, rodada_id } = Endereco.ler(String(params.ref));
  if (rodada_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é uma rodada`, "use o endereço da rodada, como I-206.R2");
  return { demanda_id, rodada_id };
}

/** O corpo é a entrada do gate (`resultado`, `nota` e `motivo`): quem valida é o gate. */
async function decisaoDaDemanda({ banco, params, corpo }: Pedido) {
  const { demanda, canceladas } = await decidirGate(
    banco,
    "gate_demanda",
    Endereco.daDemanda(String(params.id)),
    corpo,
    AUDITOR,
  );
  return { demanda, canceladas };
}

async function decisaoDoPlanejamento({ banco, params, corpo }: Pedido) {
  const { demanda } = await decidirGate(
    banco,
    "gate_planejamento",
    Endereco.daDemanda(String(params.id)),
    corpo,
    AUDITOR,
  );
  return demanda;
}

async function decisaoDoPR(pedido: Pedido) {
  const { demanda_id, rodada_id } = refDaRodada(pedido);
  const { demanda, sessao } = await decidirGate(
    pedido.banco,
    "gate_pr",
    Endereco.daRodada(demanda_id, rodada_id),
    pedido.corpo,
    AUDITOR,
  );
  return sessao === undefined ? demanda : { sessao };
}

const concluir = (pedido: Pedido) => concluirSessaoAjustes(pedido.banco, refDaRodada(pedido), AUDITOR);

/** O `:ref` do caminho como ticket (`I-206.T3`). */
function refDoTicket({ params }: Pedido) {
  const { demanda_id, ticket_id } = Endereco.ler(String(params.ref));
  if (ticket_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é um ticket`, "use o endereço do ticket, como I-206.T3");
  return { demanda_id, ticket_id };
}

function reabertura(pedido: Pedido) {
  const { demanda_id, ticket_id } = refDoTicket(pedido);
  const { instrucao } = ReaberturaDoTicket.parse(pedido.corpo);
  return { ticket: reabrir(pedido.banco, demanda_id, { ticket_id, instrucao }, AUDITOR, pedido.relogio) };
}

/** Aceito, responde 204; recusado pelo Despacho, responde o `MotivoDeRecusa`. */
async function executar(pedido: Pedido): Promise<unknown> {
  const { agendador } = pedido;
  if (!agendador.executarAgora)
    throw new ErroDeRegra(
      "o agendador não executa tickets de demanda",
      "suba a Fabriquinha com o serviço (fabriquinha servir)",
    );
  const recusa = await agendador.executarAgora(refDoTicket(pedido));
  return recusa && recusaEmJson(recusa);
}

const cancelamento = ({ banco, params, relogio }: Pedido) =>
  cancelar(banco, String(params.id), AUDITOR, { agora: relogio.agora() });
const arquivamento = ({ banco, params, relogio }: Pedido) => ({
  demanda: arquivar(banco, String(params.id), AUDITOR, { agora: relogio.agora() }),
});

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
