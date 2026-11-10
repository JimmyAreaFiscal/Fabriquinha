// Rotas da página do projeto (F7 §4.2): as demandas do projeto com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap do projeto.
import { arquivarConcluidas } from "../../../aplicacao/gestao_demandas.ts";
import {
  consultarHeatmapDoProjeto,
  consultarProjeto,
  ORIENTACAO_PROJETO_INEXISTENTE,
} from "../../../aplicacao/consultas/projeto.ts";
import { DemandasArquivadas, FiltroDoProjeto, Heatmap, ListaDoProjeto } from "../../contrato/projeto.ts";
import type { Rota } from "../rotas.ts";

export const ROTAS_DO_PROJETO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/demandas",
    tratar: ({ banco, params, query, relogio }) =>
      consultarProjeto(banco, String(params.nome), FiltroDoProjeto.parse(Object.fromEntries(query)), relogio),
    resposta: ListaDoProjeto,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/arquivar",
    tratar: ({ banco, params, relogio }) =>
      arquivarConcluidas(banco, String(params.nome), relogio, ORIENTACAO_PROJETO_INEXISTENTE),
    resposta: DemandasArquivadas,
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/heatmap",
    tratar: ({ banco, params, relogio }) => consultarHeatmapDoProjeto(banco, String(params.nome), relogio),
    resposta: Heatmap,
  },
];
