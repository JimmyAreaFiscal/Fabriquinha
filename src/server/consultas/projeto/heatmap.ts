// A consulta da tela do heatmap: as alterações da base do projeto, lidas do Git.
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import { heatmapDo } from "../../../modulos/repositorio/publico.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import type { Heatmap } from "../../contrato/projeto.ts";
import { ORIENTACAO_PROJETO_INEXISTENTE } from "./projeto.ts";

/** O heatmap das alterações da base do projeto `nome` nos 12 meses até agora. */
export const consultarHeatmapDoProjeto = (
  gestaoDeDemandas: GestaoDeDemandas,
  nome: string,
  relogio: Relogio,
): Promise<Heatmap> => heatmapDo(gestaoDeDemandas.projeto(nome, ORIENTACAO_PROJETO_INEXISTENTE), relogio.agora());
