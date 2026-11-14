// A fachada de Sessões de IA (MELHORIAS §9): a montagem e a interface `SessoesDeAgente`, com os tipos de entrada e saída
// dela. A política (prompt, modelo, capacidades, a resposta automática a uma pergunta) chega pronta de quem pede; o
// contexto (demanda, ticket) chega como identificador opaco. Sessão, execução e chamada ao modelo têm identificações
// distintas: `IdDaSessao`, `IdDaExecucao`, e a chamada só existe somada no Uso da execução.
export {
  type ContextoDaSessao,
  type ConversaDaSessao,
  Execucao,
  type ExecucaoAberta,
  type ExecucaoLancada,
  type FalhaDaExecucao,
  type FiltroDeSessoes,
  type IdDaExecucao,
  type IdDaSessao,
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  type PedidoDasMetricasDeUso,
  type PedidoDeSessao,
  type PreparoDoLancamento,
  type RespostaAoDialogo,
  type ResumoDaSessaoComSituacao as ResumoDaSessao,
  Sessao,
  type SessoesDeAgente,
  type SubidaDasSessoes,
  type UsoPorContexto,
} from "./execucao/publico.ts";
export { type Harness, type LancamentoDoTicket, type LinhaDeUso, ModoTrabalho } from "./harness/publico.ts";
export { ConfiguracaoDoModelo, Effort, Modelo } from "./modelos/publico.ts";
export { type CustoDoUso, Uso, type UsoDeclarado } from "./metricas_de_execucao/publico.ts";
export type { Mensagem } from "./historico/publico.ts";
export type {
  Dialogo,
  EventoDaSessao,
  PerguntaDoAgente,
  RespostaAPergunta,
  RespostaAutomatica,
  Situacao,
} from "./chat/publico.ts";
