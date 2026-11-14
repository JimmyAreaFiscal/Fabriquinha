// Rotas da página do projeto (F7 §4.2): as demandas do projeto com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap do projeto.
import { consultarHeatmapDoProjeto } from "../../../consultas/projeto/heatmap.ts";
import { montarRepositorio } from "../../../../modulos/repositorio/publico.ts";
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
    tratar: ({ banco, cicloDeVida, demandas, params, query, relogio }) =>
      consultarProjeto(
        banco,
        cicloDeVida,
        demandas,
        String(params.nome),
        FiltroDoProjeto.parse(Object.fromEntries(query)),
        relogio,
      ),
    resposta: ListaDoProjeto,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/arquivar",
    tratar: ({ cicloDeVida, demandas, params }) => {
      const { nome } = demandas.projeto(String(params.nome), ORIENTACAO_PROJETO_INEXISTENTE);
      const arquivadas = cicloDeVida.arquivar(idsDasDemandasDoProjeto(demandas, nome), { soAsConcluidas: true });
      return { arquivadas: arquivadas.length };
    },
    resposta: DemandasArquivadas,
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/heatmap",
    tratar: ({ banco, demandas, params, relogio }) =>
      consultarHeatmapDoProjeto(montarRepositorio({ banco }), demandas, String(params.nome), relogio),
    resposta: Heatmap,
  },
];
