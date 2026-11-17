// Rotas da tela Ambientes (F7 §4.2): o conjunto de containers com o uso e o que roda em cada um.
import { AmbientesEmUso } from "../contrato/ambientes.ts";
import type { Rota } from "../rotas.ts";
import { consultarAmbientesEmUso } from "./consulta_ambientes.ts";

export const ROTAS_DOS_AMBIENTES: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/ambientes",
    tratar: ({ banco, cicloDeVida, ambientes, demandas }) =>
      consultarAmbientesEmUso(banco, cicloDeVida, ambientes, demandas),
    resposta: AmbientesEmUso,
  },
];
