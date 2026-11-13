// O commit do ticket da demanda (comparacao-sdlc-implementacao.md §6) como o Ciclo de Vida o pede ao Repositório: a marca
// `[I-n.Tm]`, que o torna idempotente, a mensagem `feat|fix: <título> [I-n.Tm]` e a recusa do ticket do Plano sem alteração.
import type { DatabaseSync } from "node:sqlite";
import { PRIMEIRA_ETAPA_DA_RODADA, type TicketDemanda } from "../../../processo/publico.ts";
import { formatarTicketRef } from "../../../etapas/publico.ts";
import { type Commit, type EspacoDeTrabalho, montarRepositorio } from "../../../../repositorio/publico.ts";
import type { ProjetoConduzido } from "../projetos_cadastrados.ts";

type Ref = Parameters<typeof formatarTicketRef>[0];

/** A marca do ticket na mensagem do commit, que acha o commit já feito. */
export const marcaDoTicket = (ref: Ref): string => `[${formatarTicketRef(ref)}]`;

/**
 * Commita o ticket no Espaço, com os hooks e sem credenciais, e o grava; o commit que já tem a marca é reaproveitado.
 * Na resolução do conflito, o commit conclui o merge em andamento, mesmo sem alteração; o ticket do Plano (a primeira
 * Etapa da rodada) sem alteração não gera commit vazio e é rejeitado com `ErroDeReprovacao`.
 */
export function commitarTicketDemanda(
  banco: DatabaseSync,
  ref: Ref,
  {
    projeto,
    espaco,
    tipo,
    titulo,
    etapa,
  }: {
    projeto: Pick<ProjetoConduzido, "nome" | "raiz_git">;
    espaco: EspacoDeTrabalho;
    tipo: "feat" | "fix";
    titulo: string;
    etapa: TicketDemanda["etapa"];
  },
  limiteMs?: number,
): Promise<Commit> {
  const marca = marcaDoTicket(ref);
  return montarRepositorio({ banco }).commitar(
    projeto,
    espaco,
    {
      demanda_id: ref.demanda_id,
      ticket_id: ref.ticket_id,
      marca,
      mensagem: `${tipo}: ${titulo} ${marca}`,
      ...(etapa === PRIMEIRA_ETAPA_DA_RODADA && {
        recusaSemAlteracao: `o ticket ${formatarTicketRef(ref)} terminou sem alteração na worktree e não gera commit vazio: faça nos arquivos da worktree a correção que o ticket pede; o corpo do PR nasce da mensagem do PR no encerramento da rodada e não muda nesta etapa`,
      }),
    },
    limiteMs,
  );
}
