// Coleta por etapa depois do pi (F3 §7). Só roda quando o pi terminou bem; se ele falhou, o ticket falha direto.
import type { DatabaseSync } from "node:sqlite";
import type { Ticket } from "../dominio/agregado.ts";
import type { Etapa } from "../dominio/primitivos.ts";
import { descartarAlteracoes } from "../repositorio/worktree.ts";

type Coleta = (banco: DatabaseSync, ticket: Ticket, worktree: string, log: string) => Promise<unknown>;

const descartar: Coleta = (_banco, _ticket, worktree, log) => descartarAlteracoes(worktree, log);

/**
 * Registro e desenho não mudam código: o descarte (F5 §3.3) vem depois de as evidências estarem guardadas.
 * ponytail: desenvolvimento, revisão, encerramento e sessão entram aqui com os tickets 15, 16, 20 e 21.
 */
const DEPOIS_DO_PI: Partial<Record<Etapa, Coleta>> = { registro: descartar, desenho: descartar };

/** F3 §9: o que a Fabriquinha faz na worktree e no banco ao fim do pi do ticket; etapa sem coleta não faz nada. */
export async function depoisDoPi(banco: DatabaseSync, ticket: Ticket, worktree: string, log: string): Promise<void> {
  await DEPOIS_DO_PI[ticket.etapa]?.(banco, ticket, worktree, log);
}
