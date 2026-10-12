// Rota do Início (F7 §4.2): o board das issues em andamento. As sessões que aguardam e as que rodam vêm de
// `GET /api/sessoes`; o Registrar necessidade usa `POST /api/registros`, do chat (rotas/chat.ts).
import type { DatabaseSync } from "node:sqlite";
import type { Issue, Ticket } from "../../dominio/agregado.ts";
import { agregadoExistente, issuesEmAndamento } from "../../persistencia/issues.ts";
import type { Rota } from "../rotas.ts";

/** Uma issue do board (`GET /api/board`): a issue com todos os tickets dela. */
export type IssueDoBoard = Issue & { tickets: readonly Ticket[] };

/**
 * F7 §5: as issues não concluídas de todos os projetos, da mais nova para a mais antiga. Os tickets vão todos: o
 * cliente mostra o não concluído e tira dele o que a sessão está fazendo, inclusive a de um ticket já concluído.
 * ponytail: um agregado por issue; uma consulta só quando o board pesar.
 */
const board = (banco: DatabaseSync): IssueDoBoard[] =>
  issuesEmAndamento(banco).map((id) => {
    const ag = agregadoExistente(banco, id);
    return { ...ag.issue, tickets: ag.tickets };
  });

export const ROTAS_DO_INICIO: Rota[] = [{ metodo: "GET", caminho: "/api/board", tratar: ({ banco }) => board(banco) }];
