// Espaço de Trabalho (CONCEITOS.md §7): o lugar isolado onde o trabalho de um item acontece — branch, base e pasta.
// É a única regra da pasta: o ticket com rodada usa o Espaço da rodada, o outro, o da demanda.
import { resolve } from "node:path";
import { z } from "zod";
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { branchDemanda, branchRodada, DemandaId } from "./demanda.ts";
import { Endereco } from "./item_de_trabalho.ts";
import { Slug } from "./primitivos.ts";
import type { Projeto } from "./projeto.ts";

// Não exportado: o schema só sai na R2 (sem-export-morto).
const PullRequest = z.object({
  numero: z.number().int().positive(),
  url: z.url(),
  head: z.string().min(1),
  estado: z.enum(["aberto", "integrado", "fechado"]),
});

/** @testes tipo que o teste usa para conferir o resultado */
export const EspacoDeTrabalho = z.object({
  dono: z.custom<Endereco>((valor) => valor instanceof Endereco),
  branch: z.string().min(1),
  base: z.string().min(1),
  pasta: z.string().min(1),
  pr: PullRequest.optional(),
});

export type EspacoDeTrabalho = z.infer<typeof EspacoDeTrabalho>;

const pastaDaDemanda = (raiz: string, projeto: string, demanda: string): string =>
  resolve(raiz, "worktrees", Slug.parse(projeto), DemandaId.parse(demanda));

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function espacoDaDemanda(
  projeto: Pick<Projeto, "nome" | "branch_base">,
  demanda: string,
  raiz: string,
): EspacoDeTrabalho {
  return {
    dono: Endereco.daDemanda(demanda),
    branch: branchDemanda(demanda),
    base: projeto.branch_base,
    pasta: resolve(pastaDaDemanda(raiz, projeto.nome, demanda), "demanda"),
  };
}

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function espacoDaRodada(
  projeto: Pick<Projeto, "nome">,
  demanda: string,
  rodada: number,
  raiz: string,
): EspacoDeTrabalho {
  return {
    dono: Endereco.daRodada(demanda, rodada),
    branch: branchRodada(demanda, rodada),
    base: branchDemanda(demanda),
    pasta: resolve(pastaDaDemanda(raiz, projeto.nome, demanda), "rodadas", String(rodada)),
  };
}

/** A única regra da pasta do ticket; os casos de uso a chamam em vez de escolher entre a demanda e a rodada. */
export function espacoDoTicket(
  ag: Pick<AgregadoDemanda, "demanda">,
  ticket: Pick<TicketDemanda, "rodada_id">,
  projeto: Pick<Projeto, "nome" | "branch_base">,
  raiz: string,
): EspacoDeTrabalho {
  return ticket.rodada_id === undefined
    ? espacoDaDemanda(projeto, ag.demanda.id, raiz)
    : espacoDaRodada(projeto, ag.demanda.id, ticket.rodada_id, raiz);
}
