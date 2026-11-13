// Regras de fronteira do domínio Repositório (MELHORIAS §10): a fachada publico.ts e os subdomínios abaixo. O motor
// (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DO_REPOSITORIO: RegrasDoDominio = {
  dependeDe: ["ambiente"],
  // Os subdomínios não importam uns aos outros além do Git; só a Coordenação os combina (§10, regra 1).
  subdominios: {
    git: [],
    espaco_de_trabalho: ["git"],
    commits: ["git"],
    historico: ["git"],
    hospedagem: ["git"],
    coordenacao: ["git", "espaco_de_trabalho", "commits", "historico", "hospedagem"],
  },
  // Cada um fala com o `gh`/`az`, o cadastro, o blame ou a rede do git com as credenciais do serviço.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: [
      "modulos/repositorio/commits/infra/commits_humanos.ts",
      "modulos/repositorio/espaco_de_trabalho/infra/limpeza_demanda.ts",
      "modulos/repositorio/espaco_de_trabalho/infra/worktree.ts",
      "modulos/repositorio/git/infra/comandos_git.ts",
      "modulos/repositorio/historico/infra/heatmap.ts",
      "modulos/repositorio/hospedagem/infra/conferencia_do_projeto.ts",
      "modulos/repositorio/hospedagem/infra/pr.ts",
    ],
  },
};
