// provisório: remover no ticket 22 (o agregado da demanda mudou para src/modulos/ciclo_de_vida/processo/). O contrato do
// servidor só importa o núcleo do código antigo e o CLI do agente o empacota: reexporta do arquivo do Processo, sem a fachada.
export {
  Demanda,
  RodadaDemanda,
  TicketDemanda,
  TipoDemanda,
} from "../../../ciclo_de_vida/processo/nucleo/agregado/agregado_demanda.ts";
export { Decisao } from "../../../ciclo_de_vida/processo/nucleo/gate.ts";
