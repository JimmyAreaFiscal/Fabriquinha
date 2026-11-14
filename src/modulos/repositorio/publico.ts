// Fachada do domínio Repositório (MELHORIAS §10): a montagem e a interface `RepositorioDoProjeto`, com os tipos de entrada
// e saída dela, e o Espaço de Trabalho como valor (o nome das branches, a pasta e o PR de cada Espaço), que o Ciclo de
// Vida calcula sem montar o Repositório (com o ocupante do Ambiente de cada Espaço). A fila git, o git do Ambiente e a
// varredura dos commits humanos são internos.
export type {
  Commit,
  MetricasDoRepositorio,
  PedidoDasMetricasDoRepositorio,
  PedidoDeCommit,
} from "./commits/publico.ts";
export { montarRepositorio, type RepositorioDoProjeto } from "./coordenacao/publico.ts";
export {
  branchDemanda,
  branchRodada,
  espacoDaDemanda,
  EspacoDeTrabalho,
  espacoDoTicket,
  ocupanteDoDono,
  prDoEscopo,
  prDoEspaco,
  PullRequest,
  type ResultadoAtualizacao,
} from "./espaco_de_trabalho/publico.ts";
export { Hospedagem, type ProjetoDoRepositorio } from "./git/publico.ts";
export type { Heatmap } from "./historico/publico.ts";
export type { LeituraDoPR, OpcoesVerificacao, ProblemasDoPR } from "./hospedagem/publico.ts";
