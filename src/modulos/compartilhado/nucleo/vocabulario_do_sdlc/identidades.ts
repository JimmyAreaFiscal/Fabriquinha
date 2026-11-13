// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/; vem da API de Etapas, sem a fachada: o CLI do
// agente o empacota, e a fachada traria Verificações e, com elas, o banco)
export {
  branchDemanda,
  branchRodada,
  CaminhoPrevisto,
  CriterioId,
  DemandaId,
  formatarRodadaRef,
  formatarTicketRef,
  RodadaRef,
  TicketIdentidade,
  TicketRef,
} from "../../../ciclo_de_vida/etapas/publico.ts";
