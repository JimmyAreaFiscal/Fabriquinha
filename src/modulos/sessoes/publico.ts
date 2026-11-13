// A fachada de Sessões de IA (MELHORIAS §9): a montagem e a interface `SessoesDeAgente`, com os tipos de entrada e saída
// dela. A política (prompt, modelo, capacidades, a resposta automática a uma pergunta) chega pronta de quem pede; o
// contexto (demanda, ticket) chega como identificador opaco. Sessão, execução e chamada ao modelo têm identificações
// distintas: `IdDaSessao`, `IdDaExecucao`, e a chamada só existe somada no Uso da execução.
export {
  type ContextoDaSessao,
  Execucao,
  type FalhaDaExecucao,
  type FiltroDeSessoes,
  type IdDaExecucao,
  type IdDaSessao,
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  type PedidoDasMetricasDeUso,
  type RespostaAoDialogo,
  type ResumoDaSessaoComSituacao as ResumoDaSessao,
  Sessao,
  type SessoesDeAgente,
  type SubidaDasSessoes,
  type UsoPorContexto,
} from "./execucao/publico.ts";
export {
  type EventoDoAgente,
  type Harness,
  type LancamentoDoTicket,
  ModoTrabalho,
  type ProcessoDoAgente,
  type RespostaDaConsulta,
} from "./harness/publico.ts";
export { ConfiguracaoDoModelo, Effort, Modelo } from "./modelos/publico.ts";
export { type CustoDoUso, Uso, type UsoDeclarado } from "./metricas_de_execucao/publico.ts";
export type { LinhaDeUso } from "./harness/publico.ts";
export type { Mensagem } from "./historico/publico.ts";
export type {
  Dialogo,
  EventoDaSessao,
  PerguntaDoAgente,
  RespostaAPergunta,
  RespostaAutomatica,
  Situacao,
} from "./chat/publico.ts";

// ponytail: provisórios do Ciclo de Vida, que ainda conduz a execução por dentro de Sessões; saem no passo 6 (o motor
// vira as Sessões montadas entregues ao Ciclo de Vida). O relatório de produtividade e a árvore de custos do
// encerramento ainda leem o Uso pela condução.
export { lerUsoDeclarado, linhaDeUsoDaExecucao, registrarUso, UsoDaExecucao } from "./metricas_de_execucao/publico.ts";
// Condução (passo 6):
export { PREFIXO_DA_RESPOSTA_AUTOMATICA, atividadeDo } from "./chat/publico.ts";
export { texto } from "./historico/publico.ts";
export {
  carregarSessoesDoContexto,
  comSessoesDoContexto,
  contextoDaExecucao,
  contextoDaSessao,
  criarSessao,
  encerrarExecucaoComUso,
  encerrarExecucaoOrfa,
  escopoDaExecucao,
  execucaoVivaDoToken,
  execucoesAbertas,
  gravarAmbienteDaExecucao,
  iniciarExecucao,
  MotorDasSessoes,
  motorDasSessoes,
  pastasDoProcesso,
  type PedidoDeProcesso,
  registrarUsoDaConsulta,
  retomarSessao,
} from "./execucao/publico.ts";
