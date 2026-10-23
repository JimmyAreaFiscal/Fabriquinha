// Projeto (F1 §3.3). O formato é validado aqui; repositório, branch, remoto e modelos são conferidos
// pelo F5 e pelo F4 antes de C19, que só grava (`registrarProjeto` e `editarProjeto` no F2).
import { isAbsolute } from "node:path";
import { z } from "zod";
import { Effort, Etapa, Modelo, Slug, unicoPor } from "./primitivos.ts";

const MENSAGEM_LINK = "Informe um link http(s) válido, como https://produto.exemplo.com";

export const Hospedagem = z.enum(["github", "azure-devops"]);

export const Projeto = z.strictObject({
  nome: Slug,
  repo: z.string().refine(isAbsolute, "caminho absoluto"),
  branchBase: z.string().min(1),
  hospedagem: Hospedagem,
  preparacao: z.array(z.string().trim().min(1)).default([]),
  testes: z.array(z.string().trim().min(1)).min(1),
  sonar: z.strictObject({ projectKey: z.string().min(1) }),
  fitness: z
    .array(
      z.strictObject({ nome: Slug, comando: z.string().trim().min(1), descricao: z.string().trim().min(1).max(300) }),
    )
    .min(1)
    .refine(unicoPor("nome"), "nome de fitness function repetido"),
  modelos: z.partialRecord(Etapa, Modelo).default({}),
  efforts: z.partialRecord(Etapa, Effort).optional(),
  // O formulário manda "" quando o campo está vazio.
  linkProduto: z
    .union([z.literal("").transform(() => undefined), z.url({ protocol: /^https?$/, error: MENSAGEM_LINK })], {
      error: MENSAGEM_LINK,
    })
    .optional(),
});

export type Hospedagem = z.infer<typeof Hospedagem>;
export type Projeto = z.infer<typeof Projeto>;
