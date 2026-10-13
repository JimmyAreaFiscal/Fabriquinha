// Rotas da página do projeto (F7 §4.2): as issues do projeto com os tickets e as sessões ativas, e o C18 do projeto.
// O Registrar necessidade usa `POST /api/registros`, do chat (rotas/chat.ts).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Agregado, AUDITOR, type Issue, type Ticket } from "../../dominio/agregado.ts";
import { encontrado } from "../../dominio/erros.ts";
import type { Fase, Id } from "../../dominio/primitivos.ts";
import { type InfoSessao, sessoes } from "../../execucao/sessoes.ts";
import {
  agregadoExistente,
  arquivarConcluidas,
  fasesPercorridas,
  issuesEmAndamento,
  situacaoDasIssues,
} from "../../persistencia/issues.ts";
import { projeto } from "../../persistencia/projetos.ts";
import type { Rota } from "../rotas.ts";

/** Uma linha da página do projeto: a issue, os tickets, as dependências não concluídas e o PR aberto mais recente. */
export type IssueDoProjeto = Issue & {
  tickets: readonly Ticket[];
  bloqueadaPor: readonly Id[];
  /** As fases em que a issue já esteve, para o trilho. */
  percorridas: readonly Fase[];
  pr?: { id: string; url: string };
};

/** O PR da issue: o da última evidência `pr_aberto` (F5 §5.2), com o número e o endereço. */
export function prDa(ag: Agregado): { id: string; url: string } | undefined {
  const pr = ag.evidencias.findLast((e) => e.tipo === "pr_aberto")?.dados as { id: string; url: string } | undefined;
  return pr && { id: pr.id, url: pr.url };
}

/** `GET /api/projetos/:nome/issues`: as issues pedidas, as sessões ativas do projeto e a contagem de todas. */
export interface ListaDoProjeto {
  issues: IssueDoProjeto[];
  sessoes: InfoSessao[];
  contagem: { andamento: number; concluidas: number; arquivadas: number; canceladas: number };
}

const Filtro = z.object({
  concluidas: z.stringbool().default(false),
  arquivadas: z.stringbool().default(false),
  canceladas: z.stringbool().default(false),
});

const exigirProjeto = (banco: DatabaseSync, nome: string): void => {
  encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, "escolha um projeto cadastrado na Configuração");
};

/**
 * F7 §5: as em andamento sempre; as concluídas, as arquivadas e as canceladas só quando pedidas (Q2).
 * ponytail: um agregado por issue, como o board do Início; uma consulta só quando a página pesar.
 */
async function lista(banco: DatabaseSync, nome: string, query: URLSearchParams): Promise<ListaDoProjeto> {
  exigirProjeto(banco, nome);
  const filtro = Filtro.parse(Object.fromEntries(query));
  const todas = situacaoDasIssues(banco, nome);
  const emAndamento = new Set(issuesEmAndamento(banco));
  const issues = todas
    .filter((i) => {
      if (i.cancelada) return filtro.canceladas;
      return i.arquivada ? filtro.arquivadas : !i.concluida || filtro.concluidas;
    })
    .map(({ id }): IssueDoProjeto => {
      const ag = agregadoExistente(banco, id);
      const pr = prDa(ag);
      return {
        ...ag.issue,
        tickets: ag.tickets,
        bloqueadaPor: ag.issue.deps.filter((d) => emAndamento.has(d)),
        percorridas: fasesPercorridas(banco, id),
        ...(pr && { pr }),
      };
    });
  return {
    issues,
    sessoes: await sessoes(banco, { escopo: "ativas", projeto: nome }),
    contagem: {
      andamento: todas.filter((i) => !i.concluida && !i.cancelada).length,
      concluidas: todas.filter((i) => i.concluida && !i.arquivada).length,
      arquivadas: todas.filter((i) => i.arquivada).length,
      canceladas: todas.filter((i) => i.cancelada).length,
    },
  };
}

export const ROTAS_DO_PROJETO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/issues",
    tratar: ({ banco, params, query }) => lista(banco, String(params.nome), query),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/arquivar",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      exigirProjeto(banco, nome);
      return { arquivadas: arquivarConcluidas(banco, nome, AUDITOR) };
    },
  },
];
