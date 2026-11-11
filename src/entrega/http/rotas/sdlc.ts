// Rotas da configuração SDLC do projeto (comparacao-sdlc §7.1): lê e grava o `Projeto`, ao lado do cadastro do projeto
// (`/api/projetos/:nome`).
import { z } from "zod";
import { ProjetoConfigurado } from "../../../ambiente/nucleo/projeto.ts";
import { gravarConfiguracaoSdlc, projetoExistente } from "../../../ambiente/aplicacao/projeto/cadastro.ts";
import { consultarConfiguracaoSdlc } from "../../../ambiente/aplicacao/consultas/sdlc.ts";
import { ConfiguracaoSdlcDoProjeto } from "../../contrato/sdlc.ts";
import type { Rota } from "../rotas.ts";

/** Troca a mensagem do zod por uma orientação; as regras do domínio (`custom`) já vêm em português e ficam. */
function orientar(issue: z.core.$ZodIssue): z.core.$ZodIssue {
  const campo = issue.path.at(-1);
  const message = (() => {
    if (issue.code === "invalid_value" && campo === "effort")
      return `use um valor do domínio: ${issue.values.join(", ")}`;
    if (campo === "codigo_falha") return "use um valor de 1 a 255";
    if (issue.code === "invalid_type" && issue.path.at(-2) === "modelo")
      return "informe provedor e nome do modelo juntos ou nenhum";
    if (issue.code === "too_small" && issue.origin === "array") return "informe ao menos uma linha";
    return issue.code === "custom" ? issue.message : "preencha este campo";
  })();
  return { ...issue, message };
}

export const ROTAS_DA_CONFIGURACAO_SDLC: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/configuracao-sdlc",
    tratar: ({ banco, params }) => consultarConfiguracaoSdlc(banco, String(params.nome)),
    resposta: ConfiguracaoSdlcDoProjeto,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/configuracao-sdlc",
    tratar: ({ banco, params, corpo }) => {
      const nome = String(params.nome);
      projetoExistente(banco, nome);
      const lida = ProjetoConfigurado.safeParse({ ...(corpo as object), nome });
      if (!lida.success) throw new z.ZodError(lida.error.issues.map(orientar));
      return { configurada: true, configuracao: gravarConfiguracaoSdlc(banco, lida.data) };
    },
    resposta: ConfiguracaoSdlcDoProjeto,
  },
];
