// Conformidade do PR da rodada com o plano aprovado original (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../dominio/erros.ts";
import {
  type ArquivoDaRodada,
  arquivosDaRodada,
  caminhosPlanejadosDaRodada,
  demandaExiste,
  rodadaExiste,
} from "../persistencia/metricas_demanda.ts";

export interface Conformidade {
  /** Jaccard em porcentagem, de 0 a 100. */
  percentual: number;
  comuns: number;
  uniao: number;
  ausentes: string[];
  extras: string[];
}

/** Renome conta pelo caminho novo, e o anterior só entra se estava no plano; exclusão já vem pelo caminho excluído. */
export function conformidade(planejados: string[], arquivos: ArquivoDaRodada[]): Conformidade {
  const planejado = new Set(planejados);
  const alterado = new Set<string>();
  for (const a of arquivos) {
    alterado.add(a.caminho);
    if (a.caminhoAnterior !== null && planejado.has(a.caminhoAnterior)) alterado.add(a.caminhoAnterior);
  }
  const ausentes = [...planejado].filter((c) => !alterado.has(c));
  const extras = [...alterado].filter((c) => !planejado.has(c));
  const comuns = planejado.size - ausentes.length;
  const uniao = comuns + ausentes.length + extras.length;
  return { percentual: (comuns / uniao) * 100, comuns, uniao, ausentes, extras };
}

/** `null` sem plano original da rodada (corretiva) ou sem commit. */
export function conformidadeDaRodada(banco: DatabaseSync, demandaId: string, rodadaId: number): Conformidade | null {
  if (!demandaExiste(banco, demandaId))
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o id da demanda");
  if (!rodadaExiste(banco, demandaId, rodadaId))
    throw new ErroDeInexistente(`a rodada ${String(rodadaId)} não existe em ${demandaId}`, "confira a rodada");
  const planejados = caminhosPlanejadosDaRodada(banco, demandaId, rodadaId);
  const { commits, arquivos } = arquivosDaRodada(banco, demandaId, rodadaId);
  if (planejados === undefined || planejados.length === 0 || commits === 0) return null;
  return conformidade(planejados, arquivos);
}
