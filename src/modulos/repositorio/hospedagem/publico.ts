// API do subdomínio Hospedagem (MELHORIAS §10): confere o remoto e monta, publica, consulta e integra os PRs.
export { codigo, dolares, inteiro, LIMITE_DO_CORPO, lista, neutro, plural, tabela } from "./aplicacao/corpo_do_pr.ts";
export { conferirProjeto } from "./infra/conferencia_do_projeto.ts";
export {
  integrarPR,
  lerPR,
  type OpcoesVerificacao,
  type ProblemasDoPR,
  publicarPRDe,
  verificarPR,
} from "./infra/pr.ts";
