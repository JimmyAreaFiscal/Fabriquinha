// Rotas da página do projeto (F7 §4.2): as demandas do projeto com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap do projeto.
import { arquivarConcluidas } from "../../../../modulos/ciclo_de_vida/publico.ts";
import { consultarHeatmapDoProjeto } from "../../../consultas/projeto/heatmap.ts";
import {
  consultarProjeto,
  idsDasDemandasDoProjeto,
  ORIENTACAO_PROJETO_INEXISTENTE,
} from "../../../consultas/projeto/projeto.ts";
import { DemandasArquivadas, FiltroDoProjeto, Heatmap, ListaDoProjeto } from "../../../contrato/projeto.ts";
import type { Rota } from "../../rotas.ts";

export const ROTAS_DO_PROJETO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/demandas",
    tratar: ({ banco, demandas, params, query, relogio }) =>
      consultarProjeto(banco, demandas, String(params.nome), FiltroDoProjeto.parse(Object.fromEntries(query)), relogio),
    resposta: ListaDoProjeto,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/arquivar",
    tratar: ({ banco, demandas, params, relogio }) => {
      const { nome } = demandas.projeto(String(params.nome), ORIENTACAO_PROJETO_INEXISTENTE);
      return arquivarConcluidas(banco, idsDasDemandasDoProjeto(demandas, nome), relogio);
    },
    resposta: DemandasArquivadas,
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/heatmap",
    tratar: ({ demandas, params, relogio }) => consultarHeatmapDoProjeto(demandas, String(params.nome), relogio),
    resposta: Heatmap,
  },
];
