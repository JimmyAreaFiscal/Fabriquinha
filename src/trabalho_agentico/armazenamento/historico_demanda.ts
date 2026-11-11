import type { DatabaseSync } from "node:sqlite";
import type { EtapaTicket } from "../../etapas/catalogo.ts";

interface FiltroTrabalhosDoHistorico {
  projeto?: string;
  demanda?: string;
  etapa?: EtapaTicket;
}

/** Os trabalhos agênticos que casam com o filtro, com o título da demanda, na ordem em que foram criados. */
export const trabalhosComTituloDaDemanda = (
  banco: DatabaseSync,
  filtro: FiltroTrabalhosDoHistorico,
): { id: string; titulo: string }[] =>
  banco
    .prepare(
      `SELECT s.id, d.titulo FROM trabalho_agentico s
         JOIN demanda d ON d.id = s.demanda_id
         JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id
        WHERE ($projeto IS NULL OR d.projeto = $projeto)
          AND ($demanda IS NULL OR d.id = $demanda)
          AND ($etapa IS NULL OR t.etapa = $etapa)
        ORDER BY s.rowid`,
    )
    .all({ projeto: filtro.projeto ?? null, demanda: filtro.demanda ?? null, etapa: filtro.etapa ?? null })
    .map((l) => ({ ...l }) as unknown as { id: string; titulo: string });
