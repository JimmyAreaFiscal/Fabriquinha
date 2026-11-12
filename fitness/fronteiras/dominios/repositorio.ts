// Regras de fronteira do domínio Repositório (MELHORIAS §10). O ticket 07 muda só este arquivo; o motor (../motor.ts)
// explica os campos e como declarar o domínio migrado. Até lá, src/modulos/repositorio/ segue a matriz do legado.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DO_REPOSITORIO: RegrasDoDominio = {
  migrado: false,
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
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  // Cada um fala com o `gh`/`az`, o cadastro, o blame ou a rede do git com as credenciais do serviço.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: [
      "modulos/repositorio/infra/git/cadastro.ts",
      "modulos/repositorio/infra/git/commits_humanos.ts",
      "modulos/repositorio/infra/git/heatmap.ts",
      "modulos/repositorio/infra/hospedagem/pr.ts",
      "modulos/repositorio/infra/worktree/limpeza_demanda.ts",
      "modulos/repositorio/infra/worktree/worktree.ts",
    ],
  },
};
