// Fachada do domínio Repositório (MELHORIAS §10), `RepositorioDoProjeto`: confere repositórios, prepara e limpa
// espaços, registra commits, publica e acompanha PRs, integra o PR da rodada e informa alterações e histórico. É a
// única entrada usada por fora do domínio; os subdomínios ficam atrás dela.
export {
  alteracoesDosCommitsEmLote,
  apagarCommitsDasDemandas,
  apagarVarreduraDoProjeto,
  arquivosDe,
  arquivosDosCommits,
  type Commit,
  commitar,
  commitDoTicketDemanda,
  commitsDosTicketsEmLote,
  cursorDaBase,
  gravarCommitDemanda,
  projetosAVarrer,
  registrarCommitsHumanosDoTicket,
  varrerCommitsHumanos,
} from "./commits/publico.ts";
export { cicloDoEspaco } from "./coordenacao/publico.ts";
export {
  ambienteDoEspaco,
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  descartarAlteracoes,
  espacoDaDemanda,
  espacoDaRodada,
  EspacoDeTrabalho,
  espacoDoTicket,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
  ocupanteDoAmbiente,
  pendenciasDeLimpeza,
  prDoEscopo,
  prDoEspaco,
  PullRequest,
  removerWorktrees,
  sobrasDaDemanda,
  branchDemanda,
  branchRodada,
  DemandaId,
} from "./espaco_de_trabalho/publico.ts";
export {
  exigirGit,
  exigirGitNoAmbiente,
  gitNoAmbiente,
  Hospedagem,
  naFilaDoProjeto,
  type RepositorioDoProjeto,
} from "./git/publico.ts";
export { heatmapDo } from "./historico/publico.ts";
export {
  codigo,
  conferirProjeto,
  dolares,
  integrarPR,
  inteiro,
  lerPR,
  LIMITE_DO_CORPO,
  lista,
  neutro,
  type OpcoesVerificacao,
  plural,
  type ProblemasDoPR,
  publicarPRDe,
  tabela,
  verificarPR,
} from "./hospedagem/publico.ts";
