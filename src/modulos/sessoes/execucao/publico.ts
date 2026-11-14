// A API do subdomínio Execução: a sessão e as execuções dela, a montagem das sessões de agente e os tipos da interface.
export { type ContextoDaSessao, Execucao, type IdDaExecucao, type IdDaSessao, Sessao } from "./nucleo/sessao.ts";
export type { FalhaDaExecucao } from "./nucleo/falha_da_execucao.ts";
export type { FiltroDeSessoes } from "./armazenamento/sessoes_e_execucoes.ts";
export type { RespostaAoDialogo } from "./aplicacao/motor_das_sessoes.ts";
export type {
  ExecucaoAberta,
  ExecucaoLancada,
  PedidoDeSessao,
  PreparoDoLancamento,
} from "./aplicacao/lancamento_do_pedido.ts";
export type { ConversaDaSessao } from "./aplicacao/conversa_da_sessao.ts";
export {
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  type ResumoDaSessaoComSituacao,
  type SessoesDeAgente,
  type SubidaDasSessoes,
} from "./aplicacao/montagem_das_sessoes.ts";
export type { PedidoDasMetricasDeUso, UsoPorContexto } from "./aplicacao/uso_das_metricas.ts";
