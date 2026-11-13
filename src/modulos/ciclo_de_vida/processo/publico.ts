// A API de Processo (MELHORIAS §11): o estado do desenvolvimento e o seu único escritor. O agregado da demanda e o
// repositório dele, os ciclos de vida da demanda, da rodada e do ticket, as transições, o cancelamento, as Pendências, as
// Tentativas e a política delas, o progresso do encerramento e a decisão dos gates, e as transições que a Condução e o
// Despacho pedem; o armazenamento dela é o único que fala SQL com o estado do desenvolvimento.
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
export { Decisao, type EntradaDoGate, type EntradaReprovada } from "./nucleo/gate.ts";
export {
  AgregadoDemanda,
  prDaDemanda,
  type PullRequestDoEspaco,
  type RodadaDemanda,
  TicketDemanda,
} from "./nucleo/agregado/agregado_demanda.ts";
export {
  ancoraNaDemanda,
  ancoraNaRodada,
  Gate,
  MOTIVO_APROVACAO_AUTOMATICA_PR,
} from "./nucleo/agregado/gate_da_demanda.ts";
export { materializar } from "./nucleo/agregado/materializacao_do_plano.ts";
export {
  type AcaoEsperada,
  type Pendencia,
  pendenciasDoProcesso,
  type TipoPendencia,
  type TrabalhoVivo,
} from "./nucleo/agregado/pendencia.ts";
export {
  type ContextoDemanda,
  exigirDemandaEmAndamento,
  exigirSemFalha,
  exigirSemPendencias,
  materializarPlano,
  mudarTicket,
  planoSubmetido,
  reabrirTicket,
  retomarTicketFalhoPorInfraestrutura,
  tentativasAposSair,
  ticketDaDemanda,
} from "./nucleo/transicoes/transicoes_demanda.ts";
export {
  montarMotivoFalhaDaTerceiraReprovacao,
  REPROVACOES_ATE_O_AUDITOR,
  rodadasComEstadoMudado,
} from "./nucleo/transicoes/transicoes_rodada.ts";
export { podeTentarEncerramento } from "./nucleo/transicoes/transicoes_encerramento.ts";
export {
  abrirTentativaDoTicket,
  aprovarPRIntegradoDaRodada,
  concluirEncerramentoDaDemanda,
  concluirResolucaoDoConflito,
  concluirSessaoDeAjustes,
  concluirTicketDeImplementacao,
  conferirPRDaRodada,
  decidirGateNaDemanda,
  devolverTicketAoAgente,
  ensaiarConclusaoDaSessaoDeAjustes,
  falharTicketEmExecucao,
  registrarConflitoDoEncerramento,
  registrarCorrecoesDaRodada,
  registrarFalhaDoEncerramento,
  registrarFalhaDoTicket,
  registrarIntegracaoFinal,
  registrarPRDaRodada,
  registrarTentativaDoEncerramento,
  solicitarIntegracaoFinal,
} from "./aplicacao/transicoes_pedidas.ts";
export { submeterEvidencia } from "./aplicacao/submissao_de_evidencia.ts";
export { iniciarRevisaoIntegral } from "./aplicacao/revisao_integral.ts";
export { visaoDaDemanda } from "./aplicacao/visao_da_demanda.ts";
export {
  arquivar,
  arquivarConcluidas,
  comCampoInvalidoComoErroDeRegra,
  criarProcessoDoPedido,
  declararUso,
  type EntradaEvidencia,
  levarAoGateDaDemanda,
  reabrir,
  submeterEvidenciaDaEntradaExterna,
} from "./aplicacao/gestao_do_processo.ts";
export { cancelarProcessosEmCascata } from "./aplicacao/cancelamento_em_cascata.ts";
export { arquivarDemanda, cancelarDemanda } from "./nucleo/transicoes/cancelamento_demanda.ts";
export {
  andamentoDasDemandasEmLote,
  carregarDemanda,
  carregarDemandas,
  carregarEscopoDoProcesso,
  comDemanda,
  listarDemandas,
  situacaoDasDemandas,
} from "./armazenamento/agregado_da_demanda.ts";
export {
  apagarEstadoDoProcessoDasDemandas,
  apagarEstadoQueSumiu,
  carregarEstadoDoProcesso,
  decisoesEmLote,
  gravarEstadoNovoEMudado,
  lerTentativasDasDemandas,
  tentativasReprovadasEmLote,
} from "./armazenamento/estado_do_processo.ts";
