// A consulta da tela do heatmap: as alterações da base do projeto, lidas do Git.
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../../modulos/compartilhado/nucleo/relogio.ts";
import { heatmapDo } from "../../../modulos/repositorio/infra/git/heatmap.ts";
import { projetoExistente } from "../../../modulos/projeto/aplicacao/cadastro.ts";
import type { Heatmap } from "../../contrato/projeto.ts";
import { ORIENTACAO_PROJETO_INEXISTENTE } from "./projeto.ts";

/** O heatmap das alterações da base do projeto `nome` nos 12 meses até agora. */
export const consultarHeatmapDoProjeto = (banco: DatabaseSync, nome: string, relogio: Relogio): Promise<Heatmap> =>
  heatmapDo(projetoExistente(banco, nome, ORIENTACAO_PROJETO_INEXISTENTE), relogio.agora());
