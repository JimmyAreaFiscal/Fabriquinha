// Projeto (F1 §3.3). O formato é validado aqui; repositório, branch e remoto são conferidos pelo F5 antes de C19, que
// só grava (`registrarProjeto` e `editarProjeto` no F2). A chave do SonarQube começa com o nome do projeto e é editada na
// configuração SDLC do projeto (configuracao_projeto.ts), a fonte do fluxo da demanda.
import { isAbsolute } from "node:path";
import { z } from "zod";
import { Slug } from "./primitivos.ts";

const MENSAGEM_LINK = "Informe um link http(s) válido, como https://produto.exemplo.com";

export const Hospedagem = z.enum(["github", "azure-devops"]);

export const Projeto = z.strictObject({
  nome: Slug,
  repo: z.string().refine(isAbsolute, "caminho absoluto"),
  branchBase: z.string().min(1),
  hospedagem: Hospedagem,
  preparacao: z.array(z.string().trim().min(1)).default([]),
  sonar: z.strictObject({ projectKey: z.string().min(1) }),
  // O formulário manda "" quando o campo está vazio.
  linkProduto: z
    .union([z.literal("").transform(() => undefined), z.url({ protocol: /^https?$/, error: MENSAGEM_LINK })], {
      error: MENSAGEM_LINK,
    })
    .optional(),
});

export type Hospedagem = z.infer<typeof Hospedagem>;
export type Projeto = z.infer<typeof Projeto>;
