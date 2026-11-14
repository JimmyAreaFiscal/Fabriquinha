// O que o repositório lê do Projeto (CONCEITOS.md §13): o clone, a base, a hospedagem e a Preparação da worktree. O
// Projeto inteiro, com o SonarQube, a Configuração do Agente e as Verificações, mora em projeto/.
import { z } from "zod";

export const Hospedagem = z.enum(["github", "azure-devops"]);

export type Hospedagem = z.infer<typeof Hospedagem>;

export interface ProjetoDoRepositorio {
  nome: string;
  raiz_git: string;
  branch_base: string;
  hospedagem: Hospedagem;
  /** Os comandos que rodam, em ordem, ao criar a worktree. */
  verificacoes: { preparacao: string[] };
}
