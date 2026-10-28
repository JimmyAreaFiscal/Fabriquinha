// Rota da página do projeto (F7 §4.2): o heatmap do projeto.
import { encontrado } from "../../dominio/erros.ts";
import { projeto } from "../../persistencia/projetos.ts";
import { heatmapDo } from "../../repositorio/heatmap.ts";
import type { Rota } from "../rotas.ts";

export const ROTAS_DO_PROJETO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/heatmap",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return heatmapDo(
        encontrado(
          projeto(banco, nome),
          `o projeto ${nome} não existe`,
          "escolha um projeto cadastrado na Configuração",
        ),
      );
    },
  },
];
