// Fronteira interna do subdomínio Commits (MELHORIAS §10): o commit de cada ticket e os commits humanos, com o cursor da
// varredura. Só a Coordenação a usa; por fora do módulo, vale a interface do Repositório.
export { acharCommitComMarca, commitarTicket, type PedidoDeCommit } from "./aplicacao/commit_do_ticket.ts";
export { varrerBasesVencidas, varrerCommitsHumanos } from "./aplicacao/varredura_de_commits_humanos.ts";
export {
  alteracoesDosCommitsEmLote,
  apagarCommitsDasDemandas,
  arquivosDosCommits,
  commitDoTicketDemanda,
  commitsDosTicketsEmLote,
} from "./armazenamento/commits_demanda.ts";
export { apagarVarreduraDoProjeto, cursorDaBase } from "./armazenamento/commits_humanos.ts";
export { arquivosDe } from "./infra/commit.ts";
export type { ArquivoCommit, Commit } from "./nucleo/commits.ts";
