// API do subdomínio Commits (MELHORIAS §10): o commit de cada ticket e os commits humanos, com o cursor da varredura.
export { registrarCommitsHumanosDoTicket, varrerCommitsHumanos } from "./aplicacao/varredura_de_commits_humanos.ts";
export {
  alteracoesDosCommitsEmLote,
  arquivosDosCommits,
  commitDoTicketDemanda,
  commitsDosTicketsEmLote,
  gravarCommitDemanda,
} from "./armazenamento/commits_demanda.ts";
export { cursorDaBase, projetosAVarrer } from "./armazenamento/commits_humanos.ts";
export { arquivosDe, commitar } from "./infra/commit.ts";
export type { Commit } from "./nucleo/commits.ts";
