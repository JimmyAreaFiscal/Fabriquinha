// As predecessoras pendentes de uma demanda pelo estado do desenvolvimento (comparacao-sdlc-implementacao.md §3): o
// Despacho e as telas ainda as leem assim. O registro das dependências e os dependentes são de Demandas (Dependências);
// o Despacho passa a receber as demandas liberadas no ticket 20.
import { satisfazDependencia } from "../ciclo_de_vida/cancelamento_demanda.ts";
import type { EstadoDemanda } from "../ciclo_de_vida/ciclos.ts";

/** CA-9 e CA-10: os ids das predecessoras que ainda não satisfazem a dependência (D08: arquivada satisfaz). */
export const predecessorasPendentes = (
  predecessoras: readonly { demanda_id: string; estado: EstadoDemanda }[],
): string[] => predecessoras.filter((p) => !satisfazDependencia(p.estado)).map((p) => p.demanda_id);
