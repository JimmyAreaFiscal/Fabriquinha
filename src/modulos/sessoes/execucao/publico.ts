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
  execucoesEmLote,
  gravarAmbienteDaExecucao,
  gravarTokenDaExecucao,
  resumoDaSessao,
  type ResumoDaSessao,
  resumosDasSessoesEmLote,
  sessaoDeCadaTicketDasDemandas,
} from "./armazenamento/sessoes_e_execucoes.ts";
export { carregarSessoesDoContexto, comSessoesDoContexto, usoEmLote } from "./aplicacao/sessoes_do_contexto.ts";
export { encerrarExecucaoComUso, encerrarExecucaoOrfa, registrarUsoDaConsulta } from "./aplicacao/encerramento.ts";
export { type PedidoDeProcesso, SessoesDeAgente } from "./aplicacao/sessoes_de_agente.ts";
