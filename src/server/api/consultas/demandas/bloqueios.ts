// A regra única de bloqueio de uma demanda: ela é bloqueada pelas predecessoras que ainda não satisfazem a Dependência
// (concluída e arquivada satisfazem, D08). O board, o Início e a página do projeto mostram os mesmos bloqueios.
import { satisfazDependencia } from "../../../../modulos/sdlc/nucleo/ciclo_de_vida/cancelamento_demanda.ts";
import type { EstadoDemanda } from "../../../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";

interface Predecessora {
  demanda_id: string;
  estado: EstadoDemanda;
}

/** As predecessoras que bloqueiam a demanda, na ordem recebida. */
export const bloqueiosDaDemanda = (predecessoras: readonly Predecessora[]): Predecessora[] =>
  predecessoras.filter((p) => !satisfazDependencia(p.estado));
