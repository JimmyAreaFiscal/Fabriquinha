// Fronteira interna do subdomínio Hospedagem (MELHORIAS §10): confere o remoto e publica, consulta e integra os PRs.
export { conferirProjeto } from "./infra/conferencia_do_projeto.ts";
export {
  integrarPR,
  type LeituraDoPR,
  lerPR,
  type OpcoesVerificacao,
  type ProblemasDoPR,
  publicarPRDe,
  verificarPR,
} from "./infra/pr.ts";
