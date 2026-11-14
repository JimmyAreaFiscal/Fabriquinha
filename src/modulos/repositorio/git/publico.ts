// Fronteira interna do subdomínio Git (MELHORIAS §10): o git do clone do host e o do Espaço, pelo Ambiente, e a fila git
// por projeto.
export { Hospedagem, type ProjetoDoRepositorio } from "./nucleo/repositorio_do_projeto.ts";
export {
  envCompletoDoServico,
  exigirGit,
  exigirGitNoAmbiente,
  gitNoAmbiente,
  naFilaDaPasta,
  naFilaDoProjeto,
  pastaDasWorktreesDoProjeto,
} from "./infra/comandos_git.ts";
