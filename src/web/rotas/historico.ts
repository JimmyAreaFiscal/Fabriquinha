// Rota das sessões (F7 §4.2; F4 §5.3): as ativas, para o Início e a navegação, e as terminadas do Histórico, cada uma
// com o título da issue, o resultado e o custo, que a lista mostra por linha. A prévia lê a sessão pela rota do chat.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Agregado, Execucao } from "../../dominio/agregado.ts";
import { Etapa, type Id } from "../../dominio/primitivos.ts";
import { ABORTADA } from "../../execucao/gerente.ts";
import { type InfoSessao, sessoes } from "../../execucao/sessoes.ts";
import { agregadoExistente } from "../../persistencia/issues.ts";
import { custoPorExecucao } from "../../persistencia/metricas.ts";
import type { Rota } from "../rotas.ts";

export type Resultado = "concluida" | "falha" | "abortada";

/** Uma linha do Histórico (F7 §4.4): a sessão terminada, o título da issue, o resultado e o custo dela. */
export interface SessaoDoHistorico extends InfoSessao {
  titulo: string | null;
  resultado: Resultado;
  custo: number;
}

const FiltroSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  issue: z.coerce.number().int().positive().optional(),
  etapa: Etapa.optional(),
});

/** O resultado da sessão é o da última execução; a autônoma que o Auditor aborta falha com o erro `ABORTADA`. */
function resultado(e: Execucao | undefined): Resultado {
  if (e?.resultado !== "falha") return "concluida";
  return e.erro === ABORTADA ? "abortada" : "falha";
}

/**
 * As terminadas com o que a linha do Histórico mostra; o custo soma o `uso` de todas as execuções da sessão.
 * ponytail: relê o agregado de cada issue que `sessoes` já leu; juntar as duas leituras quando o histórico pesar.
 */
function noHistorico(banco: DatabaseSync, lista: InfoSessao[]): SessaoDoHistorico[] {
  const lidas = new Map<Id, { ag: Agregado; custos: Record<string, number> }>();
  const daIssue = (id: Id) => {
    const lida = lidas.get(id) ?? {
      ag: agregadoExistente(banco, id),
      custos: custoPorExecucao(banco, id),
    };
    lidas.set(id, lida);
    return lida;
  };
  return lista.map((s) => {
    const { ag, custos } = daIssue(s.issue);
    const execucoes = ag.execucoes.filter((e) => e.sessaoPi === s.sessao);
    return {
      ...s,
      titulo: ag.issue.titulo,
      resultado: resultado(execucoes.at(-1)),
      custo: execucoes.reduce((soma, e) => soma + (custos[String(e.id)] ?? 0), 0),
    };
  });
}

export const ROTAS_DO_HISTORICO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: async ({ banco, query }) => {
      const filtro = FiltroSessoes.parse(Object.fromEntries(query));
      const lista = await sessoes(banco, filtro);
      return filtro.escopo === "historico" ? noHistorico(banco, lista) : lista;
    },
  },
];
