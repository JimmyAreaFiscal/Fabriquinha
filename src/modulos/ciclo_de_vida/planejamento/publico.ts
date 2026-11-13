// A API de Planejamento (MELHORIAS §11): valida e mantém o plano e suas versões, materializa rodadas e tickets e controla
// as dependências internas; o armazenamento dela é o único que fala SQL com as tabelas do plano e dos itens.
export {
  CorrecaoDoPlano,
  correcaoDasRodadasNovas,
  correcaoDosTicketsDaRodada,
  lerPlanoGravado,
  materializarVersaoDoPlano,
  OrigemDaVersao,
  Plano,
  PlanoProposto,
  validarPlanoDaDemanda,
} from "./nucleo/plano.ts";
export { criarTicket, estaOcupado, GrafoDeDependencias, ticketAtualDaEtapa } from "./nucleo/item_de_trabalho.ts";
export {
  apagarItensDasDemandas,
  apagarItensQueSumiram,
  carregarItensDoPlanejamento,
  carregarResumoDosItensDoPlanejamento,
  gravarItensNovosEMudados,
  planosDasDemandas,
  type ResumoDoTicket,
  ticketsDasDemandas,
  ticketsEmExecucaoDasEtapas,
} from "./armazenamento/itens_do_planejamento.ts";
