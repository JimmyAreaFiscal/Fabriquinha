// Fachada do domínio Repositório (MELHORIAS §10): a montagem e a interface `RepositorioDoProjeto`, com os tipos de entrada
// e saída dela, e o Espaço de Trabalho como valor (o nome das branches, a pasta e o PR de cada Espaço), que o Ciclo de
// Vida calcula sem montar o Repositório. A fila git, o git do Ambiente e a varredura dos commits humanos são internos.
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
  prDoEscopo,
  prDoEspaco,
  PullRequest,
  type ResultadoAtualizacao,
} from "./espaco_de_trabalho/publico.ts";
export { Hospedagem, type ProjetoDoRepositorio } from "./git/publico.ts";
export type { Heatmap } from "./historico/publico.ts";
export type { OpcoesVerificacao, ProblemasDoPR } from "./hospedagem/publico.ts";

// ponytail: ligações provisórias. O Ambiente do Espaço e a gestão de Ambientes saem no passo 6 da migração das
// interfaces, quando o Ciclo de Vida alocar o Ambiente e o entregar ao Repositório.
export { ambienteDoEspaco, ligarGestaoDeAmbientes } from "./espaco_de_trabalho/publico.ts";
// ponytail: o SQL de `pull_request`, que o agregado da demanda do Ciclo de Vida grava na unidade de trabalho dele, sai no
// passo 6, quando o Ciclo de Vida passar a pedir o PR do Espaço ao Repositório.
export {
  apagarPullRequestsDasDemandas,
  apagarPullRequestsQueSumiram,
  gravarPullRequestsNovosEMudados,
  lerPullRequestsDaDemanda,
} from "./hospedagem/publico.ts";
