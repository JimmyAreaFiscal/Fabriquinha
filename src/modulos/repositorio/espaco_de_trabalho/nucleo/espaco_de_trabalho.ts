// Espaço de Trabalho (CONCEITOS.md §7): o lugar isolado onde o trabalho de um item acontece — branch, base e pasta.
// É a única regra da pasta: o ticket com rodada usa o Espaço da rodada, o outro, o da demanda.
import { resolve } from "node:path";
import { z } from "zod";
import { Id, Slug } from "../../../../shared/nucleo/primitivos.ts";
import type { RepositorioDoProjeto } from "../../git/publico.ts";
import { branchDemanda, branchRodada, DemandaId } from "./nome_do_espaco.ts";

/** O PR do Espaço: lido de um lugar só (`pull_request`), por rodada ou, sem rodada, o final da demanda. */
export const PullRequest = z.object({
  numero: z.number().int().positive(),
  url: z.url(),
  head: z.string().min(1),
  estado: z.enum(["aberto", "integrado", "fechado"]),
});

/** @testes tipo que o teste usa para conferir o resultado */
export const EspacoDeTrabalho = z.object({
  dono: z.object({ demanda_id: DemandaId, rodada_id: Id.optional() }),
  branch: z.string().min(1),
  base: z.string().min(1),
  pasta: z.string().min(1),
  pr: PullRequest.optional(),
});

export type EspacoDeTrabalho = z.infer<typeof EspacoDeTrabalho>;

/** A pasta das worktrees da demanda: a do Espaço da demanda e as das rodadas dela moram dentro. */
export const pastaDaDemanda = (raiz: string, projeto: string, demanda: string): string =>
  resolve(raiz, "worktrees", Slug.parse(projeto), DemandaId.parse(demanda));

/** O Espaço da demanda: parte da base do projeto. */
export function espacoDaDemanda(
  projeto: Pick<RepositorioDoProjeto, "nome" | "branch_base">,
  demanda: string,
  raiz: string,
): EspacoDeTrabalho {
  return {
    dono: { demanda_id: demanda },
    branch: branchDemanda(demanda),
    base: projeto.branch_base,
    pasta: resolve(pastaDaDemanda(raiz, projeto.nome, demanda), "demanda"),
  };
}

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function espacoDaRodada(
  projeto: Pick<RepositorioDoProjeto, "nome">,
  demanda: string,
  rodada: number,
  raiz: string,
): EspacoDeTrabalho {
  return {
    dono: { demanda_id: demanda, rodada_id: rodada },
    branch: branchRodada(demanda, rodada),
    base: branchDemanda(demanda),
    pasta: resolve(pastaDaDemanda(raiz, projeto.nome, demanda), "rodadas", String(rodada)),
  };
}

/** A única busca do PR por rodada: o da rodada ou, com `rodada_id` indefinido, o final da demanda. */
export const prDoEscopo = <T extends { rodada_id?: number }>(
  pull_requests: readonly T[] | undefined,
  rodada_id: number | undefined,
): T | undefined => pull_requests?.find((pr) => pr.rodada_id === rodada_id);

/** O PR como a demanda o guarda: o da rodada, ou o final, sem `rodada_id`. */
type PullRequestDaDemanda = PullRequest & { rodada_id?: number };

/** A leitura única do PR do Espaço: o da rodada ou, sem rodada, o final da demanda. */
export function prDoEspaco(
  ag: { pull_requests?: readonly PullRequestDaDemanda[] | undefined },
  rodada_id: number | undefined,
): PullRequest | undefined {
  const achado = prDoEscopo(ag.pull_requests, rodada_id);
  return achado && { numero: achado.numero, url: achado.url, head: achado.head, estado: achado.estado };
}

/** A única regra da pasta do ticket; os casos de uso a chamam em vez de escolher entre a demanda e a rodada. */
export function espacoDoTicket(
  ag: { demanda: { id: string }; pull_requests?: readonly PullRequestDaDemanda[] | undefined },
  ticket: { rodada_id?: number | undefined },
  projeto: Pick<RepositorioDoProjeto, "nome" | "branch_base">,
  raiz: string,
): EspacoDeTrabalho {
  const espaco =
    ticket.rodada_id === undefined
      ? espacoDaDemanda(projeto, ag.demanda.id, raiz)
      : espacoDaRodada(projeto, ag.demanda.id, ticket.rodada_id, raiz);
  const pr = prDoEspaco(ag, ticket.rodada_id);
  return pr ? { ...espaco, pr } : espaco;
}

type PullRequest = z.infer<typeof PullRequest>;
