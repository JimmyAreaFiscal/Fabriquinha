// A API do subdomínio Execução: a sessão e as execuções dela, as sessões de agente que lançam, retomam e encerram o
// harness, o encerramento com o Uso, o resumo sem a conversa e o Uso em lote.
export {
  type ContextoDaSessao,
  criarSessao,
  encerrarExecucao,
  Execucao,
  type IdDaExecucao,
  type IdDaSessao,
  iniciarExecucao,
  retomarSessao,
  Sessao,
} from "./nucleo/sessao.ts";
export type { FalhaDaExecucao } from "./nucleo/falha_da_execucao.ts";
export {
  apagarSessoesDasDemandas,
  contextoDaExecucao,
  contextoDaSessao,
  escopoDaExecucao,
  execucaoVivaDoToken,
  execucoesAbertas,
  gravarAmbienteDaExecucao,
  gravarTokenDaExecucao,
  type FiltroDeSessoes,
  type ResumoDaSessao,
} from "./armazenamento/sessoes_e_execucoes.ts";
export { pastasDoProcesso } from "./nucleo/pastas_da_execucao.ts";
export { carregarSessoesDoContexto, comSessoesDoContexto } from "./aplicacao/sessoes_do_contexto.ts";
export { encerrarExecucaoComUso, encerrarExecucaoOrfa, registrarUsoDaConsulta } from "./aplicacao/encerramento.ts";
export { MotorDasSessoes, type PedidoDeProcesso, type RespostaAoDialogo } from "./aplicacao/motor_das_sessoes.ts";
export {
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  motorDasSessoes,
  type ResumoDaSessaoComSituacao,
  type SessoesDeAgente,
  type SubidaDasSessoes,
} from "./aplicacao/montagem_das_sessoes.ts";
export type { PedidoDasMetricasDeUso, UsoPorContexto } from "./aplicacao/uso_das_metricas.ts";
