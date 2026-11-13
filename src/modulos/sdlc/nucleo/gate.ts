// O Gate do Processo (`ciclo_de_vida/processo/nucleo/gate.ts`) ligado ao agregado da demanda: as âncoras na demanda e na
// rodada, que leem as transições do agregado, e o motivo da aprovação automática do PR. Os efeitos de cada Gate ficam no
// `gate.ts` da Etapa dona dele, e `etapas/gates.ts` os junta.
import type { AgregadoDemanda, TicketDemanda } from "./demanda/agregado_demanda.ts";
import { ErroDeRegra, existe } from "../../compartilhado/nucleo/erros.ts";
import { ticketAtualDaEtapa } from "./item_de_trabalho/item_de_trabalho.ts";
import { type Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { type EstadoDemanda, type EstadoRodada } from "./ciclo_de_vida/ciclos.ts";
import { type EtapaTicket } from "../../etapas/catalogo.ts";
import { exigirDemandaDaEntrada } from "./transicoes/transicoes_demanda.ts";
import { rodadaNoEstado, ticketAtivoDaEtapa } from "./transicoes/transicoes_rodada.ts";
import { Gate as GateDoProcesso } from "../../ciclo_de_vida/publico.ts";

// provisório: remover no ticket 22 (a mecânica do Gate mudou para src/modulos/ciclo_de_vida/processo/, pela fachada)
export type { EntradaDoGate, EntradaReprovada } from "../../ciclo_de_vida/publico.ts";

/** O motivo gravado na aprovação automática do PR da rodada, para a decisão não passar por uma do Auditor. */
export const MOTIVO_APROVACAO_AUTOMATICA_PR =
  "aprovado automaticamente pela Fabriquinha: a revisão da rodada aprovou e o PR não tem conflito nem check falho";

/** O ticket âncora de um gate que decide na demanda: ela no estado do gate e o ticket atual da etapa. */
export function ancoraNaDemanda(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoDemanda, etapa: EtapaTicket) {
  exigirDemandaDaEntrada(ag, endereco.demanda_id);
  if (ag.demanda.estado !== estado) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} está em ${ag.demanda.estado} e não espera decisão`,
      `decida só no estado ${estado}`,
    );
  }
  return existe(
    ticketAtualDaEtapa(ag, etapa),
    `a demanda ${ag.demanda.id} não tem ticket de etapa ${etapa}`,
    "confira o estado da demanda",
  );
}

/** O ticket âncora de um gate que decide na rodada: ela no estado do gate e o ticket atual da etapa, ainda ativo. */
export function ancoraNaRodada(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoRodada, etapa: EtapaTicket) {
  const rodada_id = existe(
    endereco.rodada_id,
    `o endereço ${endereco.toString()} não é de uma rodada`,
    "use o endereço da rodada, como I-206.R2",
  );
  const rodada = rodadaNoEstado(ag, { demanda_id: endereco.demanda_id, rodada_id }, estado);
  return ticketAtivoDaEtapa(ag, rodada, etapa);
}

/** O Gate que decide sobre o agregado da demanda, ancorado num ticket dela. */
export abstract class Gate extends GateDoProcesso<AgregadoDemanda, TicketDemanda> {}
