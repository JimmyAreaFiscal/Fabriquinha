// A API de Processo (MELHORIAS §11): o estado do desenvolvimento. Os ciclos de vida da demanda, da rodada e do ticket, as
// Tentativas e a política delas, o progresso do encerramento e a decisão dos gates; o armazenamento dela é o único que
// fala SQL com as Tentativas, as Decisões, o encerramento e as tabelas históricas do processo.
export {
  CICLO_DA_DEMANDA,
  CICLO_DA_RODADA,
  CICLO_DO_TICKET,
  EstadoDemanda,
  estadoDaDemandaNaEtapa,
  estadoDaRodadaNaEtapa,
  EstadoRodada,
  EstadoTicket,
  etapaDoEstado,
  etapaSeguinte,
  gateQueEsperaGenteNaRodada,
  PRIMEIRA_ETAPA_DA_DEMANDA,
  PRIMEIRA_ETAPA_DA_RODADA,
} from "./nucleo/ciclos/ciclos.ts";
export {
  comReaberturaDoAuditor,
  comTentativaAberta,
  comTentativaEncerrada,
  desdeAReabertura,
  montarRetornoAoAgente,
  motivoDaFalhaDoTicket,
  POLITICA_DE_TENTATIVAS,
  type RetornoAoAgente,
  retornoAoAgenteDoTicket,
  Tentativa,
  tentativaAnteriorEmMemoria,
  tentativasDoTicket,
} from "./nucleo/tentativa.ts";
export { ProgressoEncerramento } from "./nucleo/progresso_do_encerramento.ts";
export { Decisao, type EntradaDoGate, type EntradaReprovada, Gate } from "./nucleo/gate.ts";
export {
  apagarEstadoDoProcessoDasDemandas,
  apagarEstadoQueSumiu,
  carregarEstadoDoProcesso,
  decisoesEmLote,
  gravarEstadoNovoEMudado,
  lerTentativasDasDemandas,
  tentativasReprovadasEmLote,
} from "./armazenamento/estado_do_processo.ts";
