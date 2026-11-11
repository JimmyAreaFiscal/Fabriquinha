// Conformidade do PR da rodada com o plano aprovado original: Jaccard entre os arquivos planejados e os alterados
// (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import {
  type ArquivoDaRodada,
  arquivosDaRodada,
  planoDaDemanda,
  rodadasComCommitNoRecorte,
} from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";

interface ConformidadeDaRodada {
  demandaId: string;
  rodadaId: number;
  /** Jaccard em porcentagem, de 0 a 100. */
  percentual: number;
  comuns: number;
  uniao: number;
  ausentes: string[];
  extras: string[];
}

/** Renome conta pelo caminho novo, e o anterior só entra se estava no plano; exclusão já vem pelo caminho excluído. */
function conformidadeDe(planejados: string[], arquivos: ArquivoDaRodada[]) {
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

export class MetricaDeConformidade extends MetricaPorEtapa<{
  /** O Jaccard de todas as rodadas do recorte juntas; `null` sem rodada com plano e commit. */
  percentual: number | null;
  comuns: number;
  uniao: number;
  rodadas: ConformidadeDaRodada[];
}> {
  readonly definicao = {
    tipo: "conformidade_com_o_plano",
    rotulo: "Conformidade do PR com o plano",
    fonte: "Plano × arquivos alterados",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    // A referência é o original aprovado: o que as correções acrescentam não está nele e conta como extra.
    // Rodada corretiva (sem plano original) ou sem caminhos planejados não tem o que comparar.
    const rodadas = rodadasComCommitNoRecorte(banco, recorte).flatMap(({ demandaId, rodadaId }) => {
      const plano = planoDaDemanda(banco, demandaId);
      const planejados = plano?.original.rodadas.find((r) => r.rodada_id === rodadaId)?.arquivos_previstos;
      if (planejados === undefined || planejados.length === 0) return [];
      return [{ demandaId, rodadaId, ...conformidadeDe(planejados, arquivosDaRodada(banco, demandaId, rodadaId)) }];
    });
    const comuns = rodadas.reduce((soma, r) => soma + r.comuns, 0);
    const uniao = rodadas.reduce((soma, r) => soma + r.uniao, 0);
    const valor = { percentual: uniao === 0 ? null : (comuns / uniao) * 100, comuns, uniao, rodadas };
    return () => valor;
  }
}
