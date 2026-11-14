// O contador de pendências do menu, numa consulta leve: só o que a regra das Pendências pede (as demandas em andamento,
// resumidas, e as sessões ativas delas), sem o mês, o board e as sessões que rodam do Início. O número é o mesmo do
// Aguarda você, porque os dois contam pela mesma regra.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import type { CicloDeVida } from "../../../modulos/ciclo_de_vida/publico.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import type { QuantidadeDePendencias } from "../../contrato/inicio.ts";
import { sessoesDasDemandas } from "../sessoes/historico_demanda.ts";
import { pendenciasDasDemandas, situacoesDoBanco, type SituacaoDaSessao } from "../demandas/pendencias.ts";

/** Quanto aguarda o Auditor, lido num snapshot só, no instante do `relogio`. */
export function consultarQuantidadeDePendencias(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): QuantidadeDePendencias {
  return lerEmSnapshot(banco, () => {
    const demandas = cicloDeVida.andamentos({ soNaoTerminadas: true });
    const sessoes = sessoesDasDemandas(banco, cicloDeVida, demandas, { escopo: "ativas" });
    return {
      quantidade: pendenciasDasDemandas(cicloDeVida, gestaoDeDemandas, demandas, sessoes, situacaoDa, relogio.agora())
        .length,
    };
  });
}
