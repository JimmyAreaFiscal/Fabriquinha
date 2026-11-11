// Revisão integral da demanda (comparacao-sdlc-implementacao.md §§3, 4, 8): inicia a revisão quando as rodadas concluem.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { iniciarRevisaoDemanda } from "../nucleo/transicoes/transicoes_demanda.ts";
import { comDemanda } from "../../demanda/armazenamento/demandas.ts";
import { type Relogio, relogioDoSistema } from "../../compartilhado/nucleo/relogio.ts";

/** Todas as rodadas concluídas: a demanda vai a `revisar_demanda` com o `revisar_demanda` aberto. */
export function iniciarRevisaoIntegral(
  banco: DatabaseSync,
  demanda_id: string,
  relogio: Relogio = relogioDoSistema,
): AgregadoDemanda {
  return comDemanda(banco, demanda_id, (ag) =>
    iniciarRevisaoDemanda(ag, { demanda_id }, FABRIQUINHA, { agora: relogio.agora() }),
  );
}
