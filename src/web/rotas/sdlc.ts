// Rotas da configuração SDLC do projeto (comparacao-sdlc §7.1): lê e grava o `Projeto` do domínio novo, ao lado do
// cadastro do projeto (`/api/projetos/:nome`).
import { z } from "zod";
import { Projeto } from "../../dominio/configuracao_projeto.ts";
import { encontrado } from "../../dominio/erros.ts";
import { configuracaoProjeto, gravarConfiguracaoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { projeto } from "../../persistencia/projetos.ts";
import type { Rota } from "../rotas.ts";

/** Troca a mensagem do zod por uma orientação; as regras do domínio (`custom`) já vêm em português e ficam. */
function orientar(issue: z.core.$ZodIssue): z.core.$ZodIssue {
  const campo = issue.path.at(-1);
  const message = (() => {
    if (issue.code === "invalid_value" && campo === "effort")
      return `use um valor do domínio: ${issue.values.join(", ")}`;
    if (campo === "codigo_falha") return "use um valor de 1 a 255";
    if (campo === "modelo_nome" && issue.code === "custom") return "informe provedor e nome do modelo juntos ou nenhum";
    if (issue.code === "too_small" && issue.origin === "array") return "informe ao menos uma linha";
    return issue.code === "custom" ? issue.message : "preencha este campo";
  })();
  return { ...issue, message };
}

const naoExiste = (nome: string) => `o projeto ${nome} não existe`;

export const ROTAS_DA_CONFIGURACAO_SDLC: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/configuracao-sdlc",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      const configuracao = configuracaoProjeto(banco, nome);
      if (configuracao) return { configurada: true, configuracao };
      const legado = encontrado(projeto(banco, nome), naoExiste(nome), "confira o nome do projeto");
      return {
        configurada: false,
        configuracao: {
          nome,
          branch_base: legado.branchBase,
          chave_sonarqube: legado.sonar.projectKey,
          raiz_git: legado.repo,
          hospedagem: legado.hospedagem,
          etapas: [],
          preparacao: [],
          fitness: [],
          linguagens: [],
          e2e: [],
          globs: [],
        },
      };
    },
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/configuracao-sdlc",
    tratar: ({ banco, params, corpo }) => {
      const nome = String(params.nome);
      encontrado(projeto(banco, nome), naoExiste(nome), "confira o nome do projeto");
      const entrada = { ...(corpo as object), nome };
      const lida = Projeto.safeParse(entrada);
      if (!lida.success) throw new z.ZodError(lida.error.issues.map(orientar));
      return { configurada: true, configuracao: gravarConfiguracaoProjeto(banco, entrada) };
    },
  },
];
